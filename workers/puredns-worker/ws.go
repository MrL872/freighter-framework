package main

// Minimal, dependency-free RFC 6455 WebSocket support -- just enough to
// serve one broadcast endpoint (server -> many browser clients, text frames
// only) without pulling in a third-party module. Kept intentionally small:
// no fragmentation of frames this server sends, no compression extensions,
// clients are only ever expected to send small control frames (ping/close),
// never application data.

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"net/http"
	"sync"
)

const websocketMagicGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

const (
	opText  = 0x1
	opClose = 0x8
	opPing  = 0x9
	opPong  = 0xA
)

// WSConn is one upgraded, hijacked HTTP connection speaking the WebSocket
// wire protocol directly over the underlying TCP socket.
type WSConn struct {
	conn   net.Conn
	br     *bufio.Reader
	bw     *bufio.Writer
	writeMu sync.Mutex
	closeOnce sync.Once
}

// Upgrade performs the WebSocket handshake by hijacking the HTTP connection.
// The caller must not write to w after this returns successfully.
func Upgrade(w http.ResponseWriter, r *http.Request) (*WSConn, error) {
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return nil, errors.New("missing Sec-WebSocket-Key")
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("connection does not support hijacking")
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return nil, err
	}
	accept := acceptKey(key)
	response := "HTTP/1.1 101 Switching Protocols\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Accept: " + accept + "\r\n\r\n"
	if _, err := rw.WriteString(response); err != nil {
		conn.Close()
		return nil, err
	}
	if err := rw.Flush(); err != nil {
		conn.Close()
		return nil, err
	}
	return &WSConn{conn: conn, br: rw.Reader, bw: rw.Writer}, nil
}

func acceptKey(key string) string {
	h := sha1.New()
	h.Write([]byte(key + websocketMagicGUID))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// WriteText sends a single, unfragmented text frame. Safe for concurrent use.
func (c *WSConn) WriteText(payload []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := writeFrame(c.bw, opText, payload); err != nil {
		return err
	}
	return c.bw.Flush()
}

// Close sends a close frame (best-effort) and closes the underlying socket.
// Safe to call more than once.
func (c *WSConn) Close() {
	c.closeOnce.Do(func() {
		c.writeMu.Lock()
		_ = writeFrame(c.bw, opClose, nil)
		_ = c.bw.Flush()
		c.writeMu.Unlock()
		_ = c.conn.Close()
	})
}

// ReadLoop blocks reading client frames until the connection closes or a
// close frame arrives, replying to pings as it goes. It never delivers
// application data -- this server's clients (browsers watching the relay)
// have nothing to say beyond protocol-level pings/close.
func (c *WSConn) ReadLoop() {
	defer c.Close()
	for {
		opcode, payload, err := readFrame(c.br)
		if err != nil {
			return
		}
		switch opcode {
		case opClose:
			return
		case opPing:
			c.writeMu.Lock()
			_ = writeFrame(c.bw, opPong, payload)
			_ = c.bw.Flush()
			c.writeMu.Unlock()
		}
	}
}

func writeFrame(w io.Writer, opcode byte, payload []byte) error {
	length := len(payload)
	header := make([]byte, 0, 10)
	header = append(header, 0x80|opcode) // FIN=1, single-frame messages only
	switch {
	case length <= 125:
		header = append(header, byte(length))
	case length <= 65535:
		ext := make([]byte, 2)
		binary.BigEndian.PutUint16(ext, uint16(length))
		header = append(header, 126)
		header = append(header, ext...)
	default:
		ext := make([]byte, 8)
		binary.BigEndian.PutUint64(ext, uint64(length))
		header = append(header, 127)
		header = append(header, ext...)
	}
	if _, err := w.Write(header); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

// readFrame reads one client->server frame. Client frames are always masked
// per RFC 6455; this unmasks the payload before returning it.
func readFrame(r *bufio.Reader) (opcode byte, payload []byte, err error) {
	head := make([]byte, 2)
	if _, err = io.ReadFull(r, head); err != nil {
		return 0, nil, err
	}
	opcode = head[0] & 0x0f
	masked := head[1]&0x80 != 0
	length := int64(head[1] & 0x7f)
	switch length {
	case 126:
		ext := make([]byte, 2)
		if _, err = io.ReadFull(r, ext); err != nil {
			return 0, nil, err
		}
		length = int64(binary.BigEndian.Uint16(ext))
	case 127:
		ext := make([]byte, 8)
		if _, err = io.ReadFull(r, ext); err != nil {
			return 0, nil, err
		}
		length = int64(binary.BigEndian.Uint64(ext))
	}
	var maskKey [4]byte
	if masked {
		mk := make([]byte, 4)
		if _, err = io.ReadFull(r, mk); err != nil {
			return 0, nil, err
		}
		copy(maskKey[:], mk)
	}
	payload = make([]byte, length)
	if _, err = io.ReadFull(r, payload); err != nil {
		return 0, nil, err
	}
	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i%4]
		}
	}
	return opcode, payload, nil
}
