#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

environment=${1:?Usage: bash seal-secrets.sh dev|prod [controller-name] [controller-namespace] [--initialize-key]}
controller_name=${2:-sealed-secrets-controller}
controller_namespace=${3:-kube-system}
key_mode=${4:-reuse}
case "$environment" in dev|prod) ;; *) printf 'Environment must be dev or prod\n' >&2; exit 1 ;; esac
case "$key_mode" in reuse|--initialize-key) ;; *) printf 'Invalid key mode\n' >&2; exit 1 ;; esac
for tool in kubectl kubeseal jq awk; do
  command -v "$tool" >/dev/null || { printf 'Missing command: %s\n' "$tool" >&2; exit 1; }
done
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
read_password() {
  local value
  read -r -s -p "$2 (URL-safe, at least 16 characters): " value
  printf '\n'
  [[ "$value" =~ ^[A-Za-z0-9_-]{16,}$ ]] || { printf 'Invalid password\n' >&2; exit 1; }
  printf -v "$1" '%s' "$value"
}
read_password pg_password 'Existing PostgreSQL admin password'
read_password migrator_password 'curves_migrator password'
read_password collector_password 'curves_collector password'
read_password reader_password 'metabase_reader password'
read_password metabase_password 'metabase_app password'
passwords=("$pg_password" "$migrator_password" "$collector_password" "$reader_password" "$metabase_password")
for ((i=0; i<${#passwords[@]}; i++)); do
  for ((j=i+1; j<${#passwords[@]}; j++)); do
    [[ "${passwords[i]}" != "${passwords[j]}" ]] || { printf 'Use distinct role passwords\n' >&2; exit 1; }
  done
done
if [[ "$key_mode" == --initialize-key ]]; then
  [[ ! -e "$root/metabase/overlays/$environment/metabase-auth.yaml" ]] || {
    printf 'Metabase secret already exists; reuse its encryption key\n' >&2; exit 1;
  }
  command -v openssl >/dev/null || { printf 'Missing command: openssl\n' >&2; exit 1; }
  encryption_key=$(openssl rand -hex 32)
else
  read -r -s -p 'Existing MB_ENCRYPTION_SECRET_KEY (recover from your secret store or cluster): ' encryption_key
  printf '\n'
fi
[[ "$encryption_key" =~ ^[A-Za-z0-9_+/=-]{32,}$ ]] || { printf 'Encryption key must contain at least 32 characters\n' >&2; exit 1; }
read -r -p 'Harbor username: ' harbor_user
read -r -s -p 'Harbor password: ' harbor_password
printf '\n'
[[ -n "$harbor_user" && -n "$harbor_password" ]] || { printf 'Harbor credentials must not be empty\n' >&2; exit 1; }
temporary=$(mktemp -d)
cleanup() {
  unset pg_password migrator_password collector_password reader_password metabase_password encryption_key harbor_password passwords
  rm -rf -- "$temporary"
}
trap cleanup EXIT
kubeseal --controller-name "$controller_name" --controller-namespace "$controller_namespace" --fetch-cert > "$temporary/controller.pem"
# Pass secrets through files/stdin, never command-line literals.
seal() {
  local app=$1 name=$2
  shift 2
  local namespace="curves-${app}-${environment}"
  kubectl create secret generic "$name" --namespace "$namespace" "$@" --dry-run=client -o json |
    kubeseal --cert "$temporary/controller.pem" --scope strict --format yaml > "$temporary/$app/$name.yaml"
}
for app in postgres migrations collector-job metabase; do mkdir -p "$temporary/$app"; done
printf '%s' "$pg_password" > "$temporary/admin"
printf '%s' "$migrator_password" > "$temporary/migrator"
printf '%s' "$collector_password" > "$temporary/collector"
printf '%s' "$reader_password" > "$temporary/reader"
printf '%s' "$metabase_password" > "$temporary/metabase-password"
printf '%s' "$encryption_key" > "$temporary/encryption"
seal postgres postgres-auth --from-file="POSTGRES_PASSWORD=$temporary/admin"
seal postgres postgres-bootstrap --from-file="MIGRATOR_PASSWORD=$temporary/migrator" \
  --from-file="COLLECTOR_PASSWORD=$temporary/collector" --from-file="READER_PASSWORD=$temporary/reader" \
  --from-file="METABASE_PASSWORD=$temporary/metabase-password"
seal migrations postgres-auth --from-file="POSTGRES_PASSWORD=$temporary/migrator"
seal collector-job postgres-auth --from-file="POSTGRES_PASSWORD=$temporary/collector"
seal metabase metabase-auth --from-file="MB_DB_PASS=$temporary/metabase-password" \
  --from-file="MB_ENCRYPTION_SECRET_KEY=$temporary/encryption"
printf '%s\n' "$harbor_user" "$harbor_password" |
  jq -Rn '[inputs] | {auths: {"registry.faberge-eggs.ru": {username: .[0], password: .[1], auth: ((.[0] + ":" + .[1]) | @base64)}}}' > "$temporary/dockerconfig"
for app in migrations collector-job metabase; do
  seal "$app" harbor-pull-secret --type=kubernetes.io/dockerconfigjson --from-file=".dockerconfigjson=$temporary/dockerconfig"
done
# Publish only after every encryption operation succeeded.
for app in postgres migrations collector-job metabase; do
  destination="$root/$app/overlays/$environment"
  for sealed in "$temporary/$app/"*.yaml; do
    filename=$(basename -- "$sealed")
    mv -- "$sealed" "$destination/$filename"
    awk -v entry="$filename" '
      { sub(/\r$/, ""); lines[NR] = $0; if ($0 ~ "^[[:space:]]*-[[:space:]]+" entry "[[:space:]]*$") found = 1 }
      END { for (i=1; i<=NR; i++) { print lines[i]; if (!found && lines[i] ~ /^resources:[[:space:]]*$/) print "- " entry } }
    ' "$destination/kustomization.yaml" > "$temporary/kustomization.yaml"
    mv -- "$temporary/kustomization.yaml" "$destination/kustomization.yaml"
  done
done
printf 'Sealed secrets prepared for %s. Commit encrypted manifests and kustomizations.\n' "$environment"
printf 'Back up MB_ENCRYPTION_SECRET_KEY from the deployed Secret to your secret store.\n'
