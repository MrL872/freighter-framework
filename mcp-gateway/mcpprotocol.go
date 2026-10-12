// mcpprotocol.go implements the actual Model Context Protocol (JSON-RPC 2.0
// over the "Streamable HTTP" transport, https://modelcontextprotocol.io) on
// top of the gateway's existing job-routing logic (router.go). /mcp/jobs and
// /mcp/workers (main.go) are this project's own non-standard REST
// API -- useful for curl/debugging, but not something a real MCP client
// (Claude Desktop, LM Studio, Open WebUI, any local-LLM agent framework that
// adds "MCP servers") can talk to, since those clients only ever speak this
// JSON-RPC protocol. This file is what makes `/mcp` addable as an MCP server
// endpoint in any compliant client.
//
// Scope: a single worker-exposing capability (tools/list, tools/call) over
// every configured worker in config.json, each mapped 1:1 onto an MCP tool
// that forwards to Gateway.Dispatch -- local/cloud routing, timeouts, and
// failure isolation all stay exactly as router.go already implements them;
// this file only translates the wire protocol. Deliberately NOT
// implemented: resources, prompts, sampling, and JSON-RPC batch arrays --
// none of this gateway's job-routing use case needs them, and every client
// this was tested against (see README) sends one request at a time. Also
// not implemented: server-initiated SSE push (GET /mcp) -- every response
// here is a single synchronous JSON object, which the Streamable HTTP spec
// explicitly allows for a server that never needs to push unsolicited
// messages, as this one doesn't.
package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
)

const mcpProtocolVersion = "2024-11-05"

type jsonrpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type jsonrpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// Standard JSON-RPC 2.0 error codes (https://www.jsonrpc.org/specification).
const (
	rpcParseError     = -32700
	rpcInvalidRequest = -32600
	rpcMethodNotFound = -32601
	rpcInvalidParams  = -32602
	rpcInternalError  = -32603
)

type mcpTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

type mcpContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type callToolResult struct {
	Content []mcpContent `json:"content"`
	IsError bool         `json:"isError"`
}

// toolInputSchema is identical for every worker -- the gateway's job model
// (router.go's JobRequest) is already worker-agnostic, so the
// MCP-facing schema is too: a flat argv array plus an optional timeout,
// exactly what POST /mcp/jobs already accepts.
func toolInputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"args": map[string]any{
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"description": "Argument vector (argv) to pass to the underlying CLI tool, e.g. [\"-u\", \"https://example.com\"].",
			},
			"timeoutSeconds": map[string]any{
				"type":        "integer",
				"description": "Overrides the gateway's configured default timeout for this call, in seconds.",
			},
		},
		"required": []string{"args"},
	}
}

// handleMCP is the single Streamable HTTP endpoint every MCP client talks
// to: one JSON-RPC request or notification per POST, one JSON-RPC response
// (or, for a notification, no body at all) per response. A client adds this
// gateway as an MCP server by pointing at this endpoint's URL directly
// (e.g. http://<host>:8811/mcp) -- see README.md for exact client config
// examples.
func handleMCP(gw *Gateway) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// CORS: several MCP clients (browser-based chat UIs with MCP
		// support in particular) run in a browser context and need this to
		// add a server at a different origin/port than their own.
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			// No server-initiated push to offer over GET -- see module
			// doc. 405 (rather than silently accepting and hanging) is the
			// honest answer for a transport feature this gateway doesn't
			// implement.
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required (GET/SSE streaming is not implemented)"})
			return
		}

		var req jsonrpcRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
			writeRPCResponse(w, nil, nil, &jsonrpcError{Code: rpcParseError, Message: "invalid JSON-RPC message"})
			return
		}
		if req.JSONRPC != "2.0" || req.Method == "" {
			writeRPCResponse(w, req.ID, nil, &jsonrpcError{Code: rpcInvalidRequest, Message: "jsonrpc must be \"2.0\" and method is required"})
			return
		}

		// A JSON-RPC message with no "id" is a notification: the sender
		// explicitly does not want a response. notifications/initialized
		// is the one every real client sends after initialize; a bare
		// `return` here (no response body written at all) is what the protocol
		// requires for it and for any other notification method.
		isNotification := len(req.ID) == 0 || string(req.ID) == "null"

		result, rpcErr := dispatchMCPMethod(r.Context(), gw, req.Method, req.Params)
		if isNotification {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		writeRPCResponse(w, req.ID, result, rpcErr)
	}
}

// writeRPCResponse writes a JSON-RPC 2.0 response containing exactly one of
// "result" or "error" -- never both, and never neither. Built as
// a plain map rather than a struct with `omitempty` tags: `omitempty` on an
// `any`-typed field uses Go's generic "is this the zero value" check, which
// treats an empty-but-meaningful result (e.g. ping's `{}`) the same as a
// genuinely absent one and would drop it from the response.
func writeRPCResponse(w http.ResponseWriter, id json.RawMessage, result any, rpcErr *jsonrpcError) {
	if id == nil {
		id = json.RawMessage("null")
	}
	resp := map[string]any{"jsonrpc": "2.0", "id": id}
	if rpcErr != nil {
		resp["error"] = rpcErr
	} else {
		resp["result"] = result
	}
	// Streamable HTTP allows a non-2xx status for a JSON-RPC-level error,
	// but the JSON-RPC body (not the HTTP status) is what every client
	// actually inspects -- 200 with an "error" field is the safer, more
	// widely-handled choice.
	writeJSON(w, http.StatusOK, resp)
}

// dispatchMCPMethod routes one JSON-RPC method to its handler. A panic
// inside any one call (e.g. a malformed params payload the per-method
// decoder doesn't expect) is recovered here into a plain JSON-RPC error
// rather than taking the whole gateway down -- same failure-isolation
// principle router.go's own Dispatch already applies to a single worker
// call.
func dispatchMCPMethod(ctx context.Context, gw *Gateway, method string, params json.RawMessage) (result any, rpcErr *jsonrpcError) {
	defer func() {
		if rec := recover(); rec != nil {
			result = nil
			rpcErr = &jsonrpcError{Code: rpcInternalError, Message: "internal error handling method"}
		}
	}()

	switch method {
	case "initialize":
		return mcpInitialize(params), nil
	case "notifications/initialized":
		return nil, nil // handled as a notification by the caller; nothing to compute
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		return mcpToolsList(gw), nil
	case "tools/call":
		return mcpToolsCall(ctx, gw, params)
	default:
		return nil, &jsonrpcError{Code: rpcMethodNotFound, Message: "unknown method: " + method}
	}
}

type initializeParams struct {
	ProtocolVersion string `json:"protocolVersion"`
}

func mcpInitialize(params json.RawMessage) map[string]any {
	// Echo back whatever protocolVersion the client asked for -- maximizes
	// compatibility across the handful of protocol revisions real clients
	// send, since this gateway's own method set (tools/list, tools/call)
	// hasn't changed across any of them. Falls back to a known-good fixed
	// version if the client didn't send one.
	version := mcpProtocolVersion
	var p initializeParams
	if len(params) > 0 && json.Unmarshal(params, &p) == nil && p.ProtocolVersion != "" {
		version = p.ProtocolVersion
	}
	return map[string]any{
		"protocolVersion": version,
		"capabilities": map[string]any{
			"tools": map[string]any{"listChanged": false},
		},
		"serverInfo": map[string]any{
			"name":    "freighter-mcp-gateway",
			"version": "1.0.0",
		},
	}
}

func mcpToolsList(gw *Gateway) map[string]any {
	workers := gw.config().Workers
	tools := make([]mcpTool, 0, len(workers))
	for name, worker := range workers {
		if !worker.IsEnabled() {
			continue
		}
		tools = append(tools, mcpTool{
			Name:        name,
			Description: "Run the " + name + " security tool (routed " + string(worker.Mode) + " by the freighter-framework MCP gateway).",
			InputSchema: toolInputSchema(),
		})
	}
	return map[string]any{"tools": tools}
}

type toolsCallParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

type toolArguments struct {
	Args           []string `json:"args"`
	TimeoutSeconds int      `json:"timeoutSeconds,omitempty"`
}

func mcpToolsCall(ctx context.Context, gw *Gateway, params json.RawMessage) (any, *jsonrpcError) {
	var call toolsCallParams
	if err := json.Unmarshal(params, &call); err != nil || call.Name == "" {
		return nil, &jsonrpcError{Code: rpcInvalidParams, Message: "params.name is required"}
	}

	var args toolArguments
	if len(call.Arguments) > 0 {
		if err := json.Unmarshal(call.Arguments, &args); err != nil {
			return nil, &jsonrpcError{Code: rpcInvalidParams, Message: "params.arguments is malformed: " + err.Error()}
		}
	}

	if worker, known := gw.config().Workers[call.Name]; !known || !worker.IsEnabled() {
		// Unknown tool name is reported as a failed tool call (isError),
		// not a protocol-level error -- the request itself was
		// well-formed, the LLM just picked a tool that doesn't exist, the
		// same distinction the MCP spec draws between a malformed request
		// and a tool that failed to execute.
		return callToolResult{
			Content: []mcpContent{{Type: "text", Text: "unknown tool: " + call.Name}},
			IsError: true,
		}, nil
	}

	jobResult := gw.Dispatch(ctx, JobRequest{Worker: call.Name, Args: args.Args, TimeoutSeconds: args.TimeoutSeconds})
	summary, err := json.Marshal(jobResult)
	if err != nil {
		summary = []byte(`{"error":"failed to encode job result"}`)
	}
	return callToolResult{
		Content: []mcpContent{{Type: "text", Text: string(summary)}},
		IsError: jobResult.State == "error",
	}, nil
}
