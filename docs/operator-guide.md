# Operator evidence inputs

These commands read a running compose deployment or public Scan. They do not
restart a node or alter Canton state. Run them near backup capture, keep their
output with the backup set, and never put credentials or identities key material
in a crv config or manifest.

The endpoint and console shapes below were checked against the pinned Splice
0.6.11 source. A public MainNet Scan returned HTTP 403 from the development
environment, so the public commands are source- and LocalNet-verified, not a
claim that every Scan operator permits every client network.

## Record the physical synchronizer

Set `SCAN_URL` to a Scan URL already trusted by the validator deployment. The
compose bundle derives this from `SCAN_ADDRESS`; do not copy an arbitrary URL
from this document.

```sh
SCAN_URL=https://scan.example
physical_serial=$(curl -fsS "$SCAN_URL/api/scan/v0/active-synchronizer-serial" | jq -er '.serial')
curl -fsS "$SCAN_URL/api/scan/v0/dso-sequencers" > /tmp/crv-dso-sequencers.json
physical_id=$(jq -er --argjson serial "$physical_serial" '
  . as $response
  | ([$response.domainSequencers[]
      | select(any(.sequencers[]; .synchronizerSerial? == $serial))
      | .domainId] | unique) as $matched
  | if ($matched | length) == 1 then $matched[0]
    elif ($matched | length) == 0
      and ([$response.domainSequencers[].domainId] | unique | length) == 1
    then [$response.domainSequencers[].domainId] | unique | .[0]
    else error("Scan did not identify exactly one active physical synchronizer")
    end
' /tmp/crv-dso-sequencers.json)
jq -n --arg id "$physical_id" --argjson serial "$physical_serial" \
  '{physicalSynchronizerId: $id, physicalSynchronizerSerial: $serial}'
```

`/v0/active-synchronizer-serial` returns the serial reported by the SV
participant. `/v0/dso-sequencers` groups sequencers by `domainId` and, after an
LSU, exposes `synchronizerSerial`. Before an LSU it may expose only
`migrationId`; the command accepts the sole `domainId` only when it is
unambiguous. Stop if it reports an error.

The participant admin API is the authoritative alternative. Follow the pinned
[Canton console access procedure](https://github.com/hyperledger-labs/splice/blob/0.6.11/docs/src/deployment/console_access.rst), connect to the compose
participant, and run these read-only expressions:

```scala
val physical = participant.synchronizers.list_connected().find(_.synchronizerAlias == "global").head.physicalSynchronizerId
physical.toProtoPrimitive
physical.serial.unwrap
```

The first result is the physical synchronizer ID and the second is its integer
serial. The command shape is also used by the pinned
[validator disaster-recovery procedure](https://github.com/hyperledger-labs/splice/blob/0.6.11/docs/src/validator_operator/validator_disaster_recovery.rst).

At capture time, write that pair into the manifest associated with the newly
completed backup set:

```sh
set_dir=/backups/validator/SET
next_manifest=$(mktemp)
jq --arg id "$physical_id" --argjson serial "$physical_serial" \
  '.declared.physicalSynchronizerId = $id
   | .declared.physicalSynchronizerSerial = $serial' \
  "$set_dir/crv-manifest.json" > "$next_manifest"
mv "$next_manifest" "$set_dir/crv-manifest.json"
```

At verification time, read the pair again and place the current values in
`crv.yaml`:

```yaml
network:
  currentPhysicalSynchronizerId: "<current physical synchronizer ID>"
  currentPhysicalSynchronizerSerial: 0 # replace with the observed integer
```

When captured and current ID/serial match, `network.lsu_path` is `PASS`. If
they differ, an LSU was crossed. Do not force a pass: also provide
`capturedPhysicalSynchronizerUsable` and a
`capturedPhysicalSynchronizerUsabilitySource` only when a trusted network
operator confirms whether the old synchronizer is still usable. Without that
source the honest result remains `UNKNOWN`.

## Refresh identities exports

An identities export contains participant private key material. Never send it
to a reviewer, paste it into an issue, or commit it to this repository. Store it
with permissions and encryption appropriate for a private key backup.

The pinned validator API exposes:

```text
GET /api/validator/v0/admin/participant/identities
```

It requires a validator-operator bearer token. Obtain that token using the
OAuth provider's client-credentials flow. Keycloak and Auth0 use different
token URLs and may express audience/scope differently; crv does not assume a
provider. This provider-neutral outline deliberately leaves those parameters
to the deployment's OAuth configuration:

```sh
token=$(curl -fsS -X POST "$TOKEN_URL" \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$VALIDATOR_AUTH_CLIENT_ID" \
  --data-urlencode "client_secret=$VALIDATOR_AUTH_CLIENT_SECRET" \
  | jq -er '.access_token')
```

For Keycloak, the pinned compose guide verifies this exact grant using the
validator backend client. For Auth0, add the configured validator API
`audience` parameter when the tenant requires it. Do not store the token,
client secret, or token response beside backup artifacts.

Export to a temporary file, validate that the response is JSON, and atomically
move it into the operator's protected backup location:

```sh
umask 077
backup_dir=/backups/validator/identities
stamp=$(date -u +%Y%m%dT%H%M%SZ)
temporary=$(mktemp "$backup_dir/.identities.XXXXXX")
curl -fsS "$VALIDATOR_URL/api/validator/v0/admin/participant/identities" \
  -H "authorization: Bearer $token" > "$temporary"
jq -e '.id and .version and .authorizedStoreSnapshot and .keys' "$temporary" >/dev/null
mv "$temporary" "$backup_dir/identities-$stamp.json"
```

Keep this in the operator-owned backup wrapper and schedule that wrapper after
the existing ordered database-pair capture, for example:

```cron
17 0 * * * /usr/local/sbin/export-validator-identities
```

Refresh after onboarding, participant identity changes, and Splice upgrades,
as well as periodically. The export records the identity and Splice version at
export time. A months-old export can therefore disagree with the current
manifest and correctly block `crv drill` as conflicting version evidence.

The endpoint and sensitivity warning are documented in the pinned
[validator backup guide](https://github.com/hyperledger-labs/splice/blob/0.6.11/docs/src/validator_operator/validator_backups.rst); the client-credentials example is in the pinned
[Keycloak compose guide](https://github.com/hyperledger-labs/splice/blob/0.6.11/docs/src/community/keycloak-docker-canton-validator-config.rst).

### If you ever have to use it

Recovery from an identities export must use the same validator party hint. On
docker-compose, pass a new, never-used participant ID with `-P`, then pass that
same new ID on every subsequent start. These are requirements of the pinned
[Splice 0.6.11 recovery procedure](https://github.com/hyperledger-labs/splice/blob/0.6.11/docs/src/validator_operator/validator_disaster_recovery.rst#L119-L166),
not conditions that crv proves.

Users onboarded after the identities capture must be re-onboarded manually, as
the pinned procedure [states explicitly](https://github.com/hyperledger-labs/splice/blob/0.6.11/docs/src/validator_operator/validator_disaster_recovery.rst#L68-L69).
Parties hosted on multiple participants and external parties are not migrated
automatically; follow the separate procedures linked in the pinned
[limitations section](https://github.com/hyperledger-labs/splice/blob/0.6.11/docs/src/validator_operator/validator_disaster_recovery.rst#L202-L214).

## Run watch under systemd

Point `watch` at a stable path that the existing backup process updates to the
freshest complete set. crv does not update that path or take the backup. Use
absolute state and report paths when service working directories may vary:

```yaml
watch:
  statePath: /var/lib/crv/state.json
  reportsPath: /var/lib/crv/reports
  intervalSeconds: 21600
  # Optional dead-man's-switch URL; leave commented to keep watch offline.
  # heartbeatUrl: https://monitor.example/ping/crv
```

Install the built CLI, then run one long-lived process:

```ini
[Unit]
Description=Verify the freshest Canton validator backup set

[Service]
Type=simple
User=validator-backup
ExecStart=/usr/local/bin/crv watch /backups/validator/latest --config /etc/crv/crv.yaml
Restart=no

[Install]
WantedBy=multi-user.target
```

Save the unit as `crv-watch.service`, then enable it with the host's normal
systemd deployment process.

`watch` verifies immediately. While the verdict is `MET`, the same process
waits `intervalSeconds` and verifies the input path again. Do not also launch it
from recurring cron: successful runs remain alive. On every cycle it writes a
schema 1.2 JSON report under `reportsPath` and atomically replaces `statePath`;
relative paths resolve from the config directory.

Set `heartbeatUrl` to send one dead-man's-switch GET after each report is
written. Non-`FAILED` verdicts use the configured URL; `FAILED` appends
`/fail`. A timeout, connection error, or non-2xx response writes
`lastHeartbeat.ok: false` to watch state and one stderr line without changing
the report, verdict, or exit code. Configure the operator's existing monitor so
silence means alarm; a service without `/fail` simply misses the failure ping.

A non-MET result is persisted before the process exits: `AT_RISK` exits 1,
`FAILED` exits 2, and `INDETERMINATE` exits 3. Invalid input/config exits 65;
internal or execution failure exits 70. Alert on the failed systemd unit or
those exit codes with the operator's existing tooling. A worsening from the
stored verdict is also printed to stderr as a regression. After remediation,
restart the unit; corrupt or mismatched state is rejected rather than silently
replaced.
