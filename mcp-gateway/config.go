package main

// Gateway configuration, loaded from a single JSON file under
// /freighter-framework/data, mounted at runtime
// rather than baked into the image. No YAML/third-party module is used here
// deliberately -- encoding/json (stdlib) is enough, and it keeps this build
// as dependency-free as the worker containers it talks to (see
// workers/subfinder-worker's own go.mod).

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"time"
)

// WorkerMode controls, per worker, whether the gateway dispatches jobs
// locally, always to the cloud, or decides automatically (local first, cloud
// fallback).
type WorkerMode string

const (
	ModeLocal WorkerMode = "local"
	ModeCloud WorkerMode = "cloud"
	ModeAuto  WorkerMode = "auto"
)

func (m WorkerMode) valid() bool {
	switch m {
	case ModeLocal, ModeCloud, ModeAuto:
		return true
	default:
		return false
	}
}

// WorkerConfig describes one routable MCP worker target. BaseURL must be a
// stable Docker service/container name (e.g. http://subfinder-worker:8080),
// never a hard-coded IP.
type WorkerConfig struct {
	BaseURL string     `json:"baseUrl"`
	Mode    WorkerMode `json:"mode"`
	// Enabled controls whether the worker is offered over MCP. A missing value
	// means enabled, so configs written before this field keep working.
	Enabled *bool `json:"enabled,omitempty"`
}

// IsEnabled reports whether the worker is offered over MCP.
func (w WorkerConfig) IsEnabled() bool {
	return w.Enabled == nil || *w.Enabled
}

// CloudConfig describes the optional cloud MCP execution target. The API key
// itself is never stored in this file -- only the name of the environment
// variable it's supplied through, so secrets stay out of the image and source
// repository.
type CloudConfig struct {
	Enabled   bool   `json:"enabled"`
	Endpoint  string `json:"endpoint"`
	APIKeyEnv string `json:"apiKeyEnv"`
}

type Config struct {
	DefaultMode           WorkerMode              `json:"defaultMode"`
	DefaultTimeoutSeconds int                     `json:"defaultTimeoutSeconds"`
	Cloud                 CloudConfig             `json:"cloud"`
	Workers               map[string]WorkerConfig `json:"workers"`
}

func (c *Config) defaultTimeout() time.Duration {
	return time.Duration(c.DefaultTimeoutSeconds) * time.Second
}

// LoadConfig reads and validates the gateway's configuration file, failing
// clearly when mandatory configuration is missing or invalid, rather than starting with a silently empty/broken routing
// table.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("config file %q does not exist -- mount gateway configuration into /freighter-framework/data", path)
		}
		return nil, fmt.Errorf("reading config file %q: %w", path, err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("config file %q is not valid JSON: %w", path, err)
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("config file %q is invalid: %w", path, err)
	}

	return &cfg, nil
}

func (c *Config) validate() error {
	if c.DefaultMode == "" {
		c.DefaultMode = ModeLocal
	}
	if !c.DefaultMode.valid() {
		return fmt.Errorf("defaultMode %q must be one of local, cloud, auto", c.DefaultMode)
	}
	if c.DefaultTimeoutSeconds <= 0 {
		c.DefaultTimeoutSeconds = 900
	}
	if len(c.Workers) == 0 {
		return fmt.Errorf("workers must list at least one MCP worker target")
	}
	for name, w := range c.Workers {
		if w.BaseURL == "" {
			return fmt.Errorf("worker %q: baseUrl is required", name)
		}
		u, err := url.Parse(w.BaseURL)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("worker %q: baseUrl %q must be an absolute http(s) URL using the worker's Docker service name, not a bare IP/host", name, w.BaseURL)
		}
		if w.Mode == "" {
			w.Mode = c.DefaultMode
			c.Workers[name] = w
		}
		if !w.Mode.valid() {
			return fmt.Errorf("worker %q: mode %q must be one of local, cloud, auto", name, w.Mode)
		}
		if (w.Mode == ModeCloud || w.Mode == ModeAuto) && !c.Cloud.Enabled {
			return fmt.Errorf("worker %q: mode %q requires cloud.enabled to be true", name, w.Mode)
		}
	}
	if c.Cloud.Enabled {
		if c.Cloud.Endpoint == "" {
			return fmt.Errorf("cloud.enabled is true but cloud.endpoint is empty")
		}
		u, err := url.Parse(c.Cloud.Endpoint)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
			return fmt.Errorf("cloud.endpoint %q must be an absolute http(s) URL", c.Cloud.Endpoint)
		}
		if c.Cloud.APIKeyEnv == "" {
			return fmt.Errorf("cloud.enabled is true but cloud.apiKeyEnv (the env var holding the cloud API key) is not set")
		}
		if os.Getenv(c.Cloud.APIKeyEnv) == "" {
			return fmt.Errorf("cloud.apiKeyEnv references environment variable %q, which is not set -- supply the cloud API key as a secret, not in this file", c.Cloud.APIKeyEnv)
		}
	}
	return nil
}
