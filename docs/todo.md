# Deferred work

- Build v0.1 only after Phase 1 review.
- Decide whether historical audit continuity should be a separate report axis
  from immediate node recovery.
- Test snapshot-provider metadata and isolated restore mechanics against a real
  Kubernetes cluster; Phase 1 maps Helm parity from charts only.
- Add compatibility fixtures for newer Splice/Canton versions after v0.1.
- Investigate a cryptographically authenticated capture manifest. A checksum in
  a manifest stored beside the artifact detects accidental damage but not an
  attacker able to rewrite both.
