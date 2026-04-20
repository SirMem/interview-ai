# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest (main) | ✅ |
| older branches | ❌ |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report security issues by emailing **sparmeet162000@gmail.com** with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You will receive a response within **48 hours**. If the issue is confirmed, a patch will be released as quickly as possible. You will be credited in the release notes unless you prefer to remain anonymous.

## Scope

This project runs **locally on your machine** — it is not a hosted service. That said, please report:

- API key leakage risks (e.g., keys logged or exposed via HTTP)
- Remote code execution via malformed screenshots or OCR input
- Electron context isolation bypasses (Node.js injection via HUD)
- Socket.IO event injection or privilege escalation
- Dependency vulnerabilities with active exploits

Out of scope: issues requiring physical access to the machine, or vulnerabilities in upstream dependencies without a known exploit.
