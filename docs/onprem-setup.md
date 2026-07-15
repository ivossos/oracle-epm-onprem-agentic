# On-Premises Oracle EPM Configuration

This guide covers deploying the oracle-epm-agentic-services with **on-premises Oracle EPM 11.1.2.4** instances.

## Key Differences: Cloud vs On-Prem

| Aspect | Cloud EPM | On-Prem EPM |
|--------|-----------|-------------|
| **Base URL** | `https://<pod>.epm.<dc>.oraclecloud.com` | `http://server:port` or `https://server:port` |
| **Auth** | OAuth 2.0 + Basic Auth | Basic Auth only |
| **MFA** | Oracle Cloud Identity | Typically LDAP/AD integration |
| **API Endpoints** | `/HyperionPlanning/rest/v3/*` | `/HyperionPlanning/rest/v3/*` (v1 for older versions) |
| **SSL Certs** | Public CA (trusted) | Self-signed or internal CA |
| **Port** | 443 (HTTPS) | Custom (typically 8080, 8443, or 9080) |

## Environment Setup

### 1. On-Prem Deployment Mode

Set `EPM_DEPLOYMENT=onprem` to enable on-prem API paths and authentication:

```bash
EPM_MODE=live
EPM_DEPLOYMENT=onprem
```

### 2. Server Connection

Configure the server hostname/port and protocol:

```bash
# HTTP (typical for internal networks)
EPM_SERVER_HOSTNAME=epm-server.internal
EPM_SERVER_PORT=8080
EPM_USE_HTTPS=false

# OR HTTPS (with certificate validation)
EPM_SERVER_HOSTNAME=epm.mycompany.com
EPM_SERVER_PORT=8443
EPM_USE_HTTPS=true
EPM_VERIFY_SSL_CERT=true

# OR HTTPS (self-signed/internal CA, dev only)
EPM_SERVER_HOSTNAME=epm-dev.internal
EPM_SERVER_PORT=8443
EPM_USE_HTTPS=true
EPM_VERIFY_SSL_CERT=false  # Disable for self-signed certs
```

### 3. Authentication

On-prem Oracle EPM 11.1.2.4 uses **Basic Auth exclusively** (no OAuth).

Provide user credentials:

```bash
# Local EPM users (not cloud-synced)
EPM_USERNAME=admin
EPM_PASSWORD=YourSecurePassword123!

# Or LDAP/AD users (if EPM is integrated with directory)
EPM_USERNAME=DOMAIN\username
EPM_PASSWORD=DirectoryPassword
```

### 4. API Version

Specify the REST API version. On-prem 11.1.2.4 typically supports `v3`:

```bash
EPM_API_VERSION=v3
```

For older on-prem versions, check if `v1` is required:

```bash
EPM_API_VERSION=v1
```

## Complete .env Example for On-Prem

```bash
# Mode: live for real instance, mock for testing without credentials
EPM_MODE=live

# Deployment: on-prem
EPM_DEPLOYMENT=onprem

# On-prem server details
EPM_SERVER_HOSTNAME=epm-prod.internal
EPM_SERVER_PORT=8080
EPM_USE_HTTPS=false
EPM_VERIFY_SSL_CERT=true

# On-prem credentials (Basic Auth)
EPM_USERNAME=admin@epm
EPM_PASSWORD=MySecurePassword123!

# API version
EPM_API_VERSION=v3

# Cloud-specific settings (ignored for on-prem)
# EPM_BASE_URL=
# EPM_IDENTITY_DOMAIN=
# EPM_OAUTH_TOKEN_URL=
# EPM_OAUTH_CLIENT_ID=
```

## Network and Firewall

Ensure network connectivity from your agent/client to the on-prem EPM server:

- **DNS Resolution**: Verify hostname resolves to the EPM server IP
- **Port Access**: Check firewall allows outbound to EPM_SERVER_PORT
- **SSL/TLS**: If using HTTPS, ensure certificates are trusted or add to local CA store

```bash
# Test connectivity (example)
curl -u admin:password http://epm-server.internal:8080/HyperionPlanning/rest/v3/applications
```

## SSL Certificate Handling

### Trusting Self-Signed Certificates (Development Only)

For dev/test environments with self-signed certificates:

```bash
EPM_USE_HTTPS=true
EPM_VERIFY_SSL_CERT=false
```

**Warning**: Never disable certificate verification in production. Use proper CA certificates instead.

### Using Internal CA Certificates

For on-prem instances with internal CA certificates:

1. Obtain the CA certificate chain
2. Add to Node.js's certificate bundle, or
3. Set the `NODE_EXTRA_CA_CERTS` environment variable:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem
npm run demo  # or your command
```

## MCP Servers

Each MCP server adapts endpoints for on-prem 11.1.2.4:

| Server | Read-only | Mutations |
|--------|-----------|-----------|
| `oracle-epm-core` | ✓ | Job execution |
| `planning-ops` | ✓ | - |
| `fccs-close` | ✓ | Journal post, clear/copy data |
| `data-integration-watchtower` | ✓ | - |
| `metadata-governance` | ✓ | - |
| `security-audit` | ✓ | - |
| `epm-automate-wrapper` | ✓ | Allowlisted commands |

### Running a Server

```bash
# Start the core MCP server (for testing)
npm run mcp:core
```

The server will detect `EPM_DEPLOYMENT=onprem` from `.env` and use on-prem endpoints.

## Testing On-Prem Connection

### 1. Config Validation

```bash
npm run demo
```

If successful (mock mode), the output shows:

```
Config: {
  mode: 'mock',
  deployment: 'onprem',
  baseUrl: null,  // mock mode doesn't need it
  ...
}
```

### 2. Live Mode Health Check

Once you have credentials, set `EPM_MODE=live` and test the core server:

```bash
EPM_MODE=live npm run mcp:core
```

Inspect MCP output to verify API calls succeed (not yet implemented, but shows deployment context).

### 3. Agent Integration

Start an agent with on-prem config:

```bash
EPM_MODE=live EPM_DEPLOYMENT=onprem npm run demo
```

Agents will use on-prem endpoints for all domain operations (Planning, FCCS, etc).

## Troubleshooting

### "EPM_SERVER_HOSTNAME is required for on-prem deployment"

**Cause**: `EPM_DEPLOYMENT=onprem` but `EPM_SERVER_HOSTNAME` is missing.

**Fix**: Set `EPM_SERVER_HOSTNAME` in your `.env`:

```bash
EPM_SERVER_HOSTNAME=your-epm-server.com
```

### "Failed to connect: ECONNREFUSED"

**Cause**: Network can't reach the server.

**Fix**: 
1. Check hostname/IP resolution: `nslookup EPM_SERVER_HOSTNAME`
2. Check port: `telnet EPM_SERVER_HOSTNAME EPM_SERVER_PORT`
3. Check firewall rules

### "Failed to authenticate: 401 Unauthorized"

**Cause**: Bad credentials or auth method mismatch.

**Fix**:
1. Verify `EPM_USERNAME` and `EPM_PASSWORD` are correct
2. Verify user has EPM access (not just directory)
3. For LDAP users, ensure `DOMAIN\username` format
4. On-prem always uses Basic Auth — don't set OAuth env vars

### "Certificate validation failed"

**Cause**: HTTPS certificate is self-signed or from internal CA.

**Fix**: For testing/dev:

```bash
EPM_VERIFY_SSL_CERT=false
```

For production, obtain a proper certificate or add CA cert to `NODE_EXTRA_CA_CERTS`.

### "API endpoint not found (404)"

**Cause**: Endpoint path doesn't match EPM version.

**Fix**: Check EPM version and adjust `EPM_API_VERSION`:

- For 11.1.2.4+: `v3`
- For 11.1.2.0–11.1.2.3: Verify with Oracle EPM docs

## Migration from Cloud to On-Prem

If migrating from cloud EPM to on-prem:

1. **Update deployment mode**:
   ```bash
   EPM_DEPLOYMENT=cloud  # Old
   EPM_DEPLOYMENT=onprem # New
   ```

2. **Replace cloud credentials with on-prem**:
   ```bash
   # Remove
   EPM_BASE_URL=https://...
   EPM_OAUTH_TOKEN_URL=...
   EPM_OAUTH_CLIENT_ID=...
   
   # Add
   EPM_SERVER_HOSTNAME=...
   EPM_SERVER_PORT=...
   EPM_USERNAME=...
   EPM_PASSWORD=...
   ```

3. **Test read-only operations first** (Planning exports, FCCS readiness, metadata).

4. **Gradually enable mutations** (job execution, data clear/copy) after validating read paths.

## Performance Tuning for On-Prem

### Job Polling

On-prem jobs may take longer than cloud. Adjust polling in MCP servers:

```typescript
// mcp/oracle-epm-core/src/client-methods.ts
const pollIntervalMs = deployment === "onprem" ? 5000 : 2000; // 5s vs 2s
```

### Large Data Exports

On-prem bandwidth may be limited. Use `BoundedResult` truncation in `planning-ops`:

```typescript
const maxRows = deployment === "onprem" ? 1000 : 5000;
```

## Security Best Practices

1. **Never commit `.env`** with real credentials. Use `.env.local` or secrets management.
2. **Audit trail**: All mutations are logged to `audit.jsonl`. Monitor for unusual activity.
3. **Approval packets**: Mutating operations require user-confirmed approval. Don't bypass this.
4. **SSL verification**: Enable `EPM_VERIFY_SSL_CERT=true` in production.
5. **Access control**: Run agents with minimal necessary EPM privileges.

## Additional Resources

- [API Mapping: Cloud vs On-Prem](./api-mapping.md)
- [Approval Model](./approval-model.md)
- [Oracle EPM REST API docs](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/)
- [EPM Automate documentation](https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/cepma/)
