#!/usr/bin/env bash
set -euo pipefail

: "${YC_IAM_TOKEN:?YC_IAM_TOKEN is required}"

bucket=${REKINDLE_BUCKET:-rekindle}
release_dir=${REKINDLE_YANDEX_RELEASE_DIR:-/private/tmp/rekindle-yandex-release}
stage_dir=$release_dir/rekindle-frontend-stage
site=${REKINDLE_SITE_URL:-https://rekindle.website.yandexcloud.net}
[[ -d "$stage_dir" ]] || { echo "Missing release stage: $stage_dir" >&2; exit 1; }

verify_dir=$(mktemp -d)
trap 'rm -rf "$verify_dir"' EXIT

while IFS= read -r -d '' source; do
    key=${source#"$stage_dir"/}
    [[ "$key" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "Unsafe object key: $key" >&2; exit 1; }
    case "$key" in
        *.html|*[/]index|*[/]index_old|*[/]privacy|*[/]terms|*[/]support) content_type='text/html; charset=utf-8' ;;
        *.css) content_type='text/css; charset=utf-8' ;;
        *.js) content_type='application/javascript; charset=utf-8' ;;
        *.json) content_type='application/json; charset=utf-8' ;;
        *.*) content_type='application/octet-stream' ;;
        *) content_type='text/html; charset=utf-8' ;;
    esac

    cache_header=()
    [[ "$key" == sw.js ]] && cache_header=(--header 'Cache-Control: no-cache, max-age=0')
    url="https://storage.yandexcloud.net/$bucket/$key"
    curl --fail --silent --show-error \
        --request PUT \
        --header "Authorization: Bearer $YC_IAM_TOKEN" \
        --header "Content-Type: $content_type" \
        "${cache_header[@]}" \
        --upload-file "$source" \
        "$url"

    headers=$verify_dir/headers
    downloaded=$verify_dir/object
    curl --fail --silent --show-error \
        --header "Authorization: Bearer $YC_IAM_TOKEN" \
        --dump-header "$headers" \
        --output "$downloaded" \
        "$url"
    cmp --silent "$source" "$downloaded" || { echo "Verification failed: $key" >&2; exit 1; }
    [[ "$content_type" != text/html* ]] || grep -qi '^content-type: text/html' "$headers"
    [[ "$key" != sw.js ]] || grep -qi '^cache-control: no-cache, max-age=0' "$headers"
    echo "Uploaded and verified $key"
done < <(find "$stage_dir" -type f -print0 | sort -z)

for key in index.html sw.js; do
    source=$stage_dir/$key
    downloaded=$verify_dir/public-object
    for attempt in {1..24}; do
        if curl --fail --silent --show-error --output "$downloaded" "$site/$key?deploy=${GITHUB_SHA:-manual}" && cmp --silent "$source" "$downloaded"; then
            echo "Production verified $key"
            break
        fi
        [[ "$attempt" -lt 24 ]] || { echo "Production did not publish $key" >&2; exit 1; }
        sleep 5
    done
done
