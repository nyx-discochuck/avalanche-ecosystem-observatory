# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository. Do not open a public issue for suspected credential exposure, path traversal, remote-code execution, or a vulnerability affecting a deployed instance.

Include affected versions, reproduction steps, impact, and any suggested mitigation. Maintainers will acknowledge a complete report as capacity allows. This volunteer project does not promise a fixed response or remediation timeline.

## Scope

The application is intended to expose read-only public analytics. Credentials belong only in server-side environment configuration and must never use a `VITE_*` name. Operators are responsible for TLS, reverse-proxy controls, process isolation, dependency updates, and access to any separately operated Avalanche Gateway.
