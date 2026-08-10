# Manual Review Summary

## Highest-priority findings
1. High: request throttling can be bypassed through untrusted `X-Forwarded-For`.
2. Medium: CORS is fail-open when no allowlist is configured.
3. Medium: multiple routes expose raw backend exception messages.
4. Medium: auth and OTP routes do not have stricter, purpose-built abuse controls beyond the global per-path limiter.

## Immediate remediation target
- Security hardening first.
- Then add targeted regression tests for CORS, trusted-proxy handling, and auth abuse controls.
