#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077

environment=${1:?Usage: bash seal-secrets.sh dev|prod [controller-name] [controller-namespace]}
controller_name=${2:-sealed-secrets-controller}
controller_namespace=${3:-kube-system}
case "$environment" in dev|prod) ;; *) printf 'Environment must be dev or prod\n' >&2; exit 1 ;; esac
for tool in kubectl kubeseal jq awk; do
  command -v "$tool" >/dev/null || { printf 'Missing command: %s\n' "$tool" >&2; exit 1; }
done
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
read -r -s -p 'PostgreSQL password (letters, digits, _, -; at least 16 characters): ' pg_password
printf '\n'
[[ "$pg_password" =~ ^[A-Za-z0-9_-]{16,}$ ]] || { printf 'Password must contain at least 16 URL-safe characters\n' >&2; exit 1; }
read -r -p 'Harbor username: ' harbor_user
read -r -s -p 'Harbor password: ' harbor_password
printf '\n'
[[ -n "$harbor_user" && -n "$harbor_password" ]] || { printf 'Harbor credentials must not be empty\n' >&2; exit 1; }
temporary=$(mktemp -d)
trap 'unset pg_password harbor_password harbor_user; rm -rf -- "$temporary"' EXIT
kubeseal --controller-name "$controller_name" --controller-namespace "$controller_namespace" --fetch-cert > "$temporary/controller.pem"

for app in postgres analyzer-service webapi-service frontend collector-job migrations; do
  namespace="curves-${app}-${environment}"
  mkdir -p "$temporary/$app"
  if [[ "$app" != frontend ]]; then
    printf '%s' "$pg_password" |
      kubectl create secret generic postgres-auth --namespace "$namespace" --from-file=POSTGRES_PASSWORD=/dev/stdin --dry-run=client -o json |
      kubeseal --cert "$temporary/controller.pem" --scope strict --format yaml > "$temporary/$app/postgres-auth.yaml"
  fi
  if [[ "$app" != postgres ]]; then
    printf '%s\n' "$harbor_user" "$harbor_password" |
      jq -Rn '[inputs] | {auths: {"registry.faberge-eggs.ru": {username: .[0], password: .[1], auth: ((.[0] + ":" + .[1]) | @base64)}}}' |
      kubectl create secret generic harbor-pull-secret --namespace "$namespace" --type=kubernetes.io/dockerconfigjson --from-file=.dockerconfigjson=/dev/stdin --dry-run=client -o json |
      kubeseal --cert "$temporary/controller.pem" --scope strict --format yaml > "$temporary/$app/harbor-pull-secret.yaml"
  fi
done

for app in postgres analyzer-service webapi-service frontend collector-job migrations; do
  destination="$root/$app/overlays/$environment"
  for sealed in "$temporary/$app/"*.yaml; do
    mv -- "$sealed" "$destination/$(basename -- "$sealed")"
  done
  awk -v postgres="$([[ "$app" != frontend ]] && printf 1 || printf 0)" \
      -v harbor="$([[ "$app" != postgres ]] && printf 1 || printf 0)" '
    { lines[NR] = $0 }
    /^[[:space:]]*-[[:space:]]+postgres-auth\.yaml[[:space:]]*$/ { has_postgres = 1 }
    /^[[:space:]]*-[[:space:]]+harbor-pull-secret\.yaml[[:space:]]*$/ { has_harbor = 1 }
    END {
      for (i = 1; i <= NR; i++) {
        print lines[i]
        if (lines[i] ~ /^resources:[[:space:]]*$/) {
          if (postgres && !has_postgres) print "- postgres-auth.yaml"
          if (harbor && !has_harbor) print "- harbor-pull-secret.yaml"
        }
      }
    }
  ' "$destination/kustomization.yaml" > "$temporary/$app/kustomization.yaml"
  mv -- "$temporary/$app/kustomization.yaml" "$destination/kustomization.yaml"
done
printf 'Sealed secrets prepared for %s. Commit the encrypted YAML files and their kustomization files.\n' "$environment"
