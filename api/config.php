<?php
// NyxTransfer — shared config & helpers
// Zero-knowledge: the server never sees plaintext content.

define('NYX_BASE',     dirname(__DIR__));
define('STORAGE_DIR',  NYX_BASE . '/storage');
define('DATA_DIR',     NYX_BASE . '/data');
define('TMP_DIR',      NYX_BASE . '/storage/tmp');
define('RATE_DIR',     DATA_DIR . '/ratelimit');

define('MAX_SIZE',        16 * 1024 * 1024 * 1024); // 16 GB (headroom for 15 GB plaintext + crypto overhead)
define('MAX_CHUNK_SIZE',  12 * 1024 * 1024);        // 12 MB per chunk (client uses 5 MB)
define('MAX_UPLOAD_TIME', 3 * 3600);                // 3 h to finish an upload
define('RATE_LIMIT_INIT', 30);                      // max upload inits per IP per hour
define('CLEANUP_BATCH',   200);                     // max files per cleanup run

if (!is_dir(STORAGE_DIR)) @mkdir(STORAGE_DIR, 0755, true);
if (!is_dir(DATA_DIR))    @mkdir(DATA_DIR,    0755, true);
if (!is_dir(TMP_DIR))     @mkdir(TMP_DIR,     0755, true);
if (!is_dir(RATE_DIR))    @mkdir(RATE_DIR,    0755, true);

// === Security headers =======================================================
function nyx_security_headers() {
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
}

function nyx_generate_id($length = 12) {
    return rtrim(strtr(base64_encode(random_bytes($length)), '+/', '-_'), '=');
}

function nyx_json($data, $code = 200) {
    http_response_code($code);
    nyx_security_headers();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data);
    exit;
}

function nyx_error($msg, $code = 400) {
    nyx_json(['error' => $msg], $code);
}

function nyx_sanitize_id($id) {
    return preg_replace('/[^a-zA-Z0-9_-]/', '', (string)$id);
}

// === Path validation (defense-in-depth) =====================================
// The sanitizer already prevents traversal, but this catches any future
// changes to the sanitization logic.
function nyx_safe_path($dir, $id, $ext) {
    $id = nyx_sanitize_id($id);
    if ($id === '') return false;
    $path    = $dir . '/' . $id . $ext;
    $dirReal = realpath($dir);
    if ($dirReal === false) return false;
    if (file_exists($path)) {
        $real = realpath($path);
        if ($real === false) return false;
        if (strpos($real, $dirReal . DIRECTORY_SEPARATOR) !== 0) return false;
    }
    return $path;
}

function nyx_read_meta($id) {
    $path = nyx_safe_path(DATA_DIR, $id, '.json');
    if (!$path || !file_exists($path)) return null;
    $raw = @file_get_contents($path);
    if ($raw === false) return null;
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

function nyx_write_meta($id, $data) {
    $path = nyx_safe_path(DATA_DIR, $id, '.json');
    if (!$path) return false;
    $tmp  = $path . '.tmp';
    if (file_put_contents($tmp, json_encode($data), LOCK_EX) === false) {
        @unlink($tmp);
        return false;
    }
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function nyx_delete_transfer($id) {
    $id = nyx_sanitize_id($id);
    if ($id === '') return;
    @unlink(STORAGE_DIR . '/' . $id . '.bin');
    @unlink(TMP_DIR     . '/' . $id . '.part');
    @unlink(DATA_DIR    . '/' . $id . '.json');
    @unlink(DATA_DIR    . '/' . $id . '.json.tmp');
    @unlink(DATA_DIR    . '/' . $id . '.lock');
}

// === Rate limiting (file-based, per IP) =====================================
function nyx_rate_limit($action, $max = RATE_LIMIT_INIT) {
    $ip   = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    $key  = hash('sha256', $ip . ':' . $action);
    $file = RATE_DIR . '/' . $key;
    $now  = time();

    $timestamps = [];
    if (file_exists($file)) {
        $raw = @file_get_contents($file);
        if ($raw !== false) {
            $timestamps = json_decode($raw, true);
            if (!is_array($timestamps)) $timestamps = [];
        }
    }

    // Keep only the last hour
    $timestamps = array_values(array_filter($timestamps, function ($ts) use ($now) {
        return $ts > $now - 3600;
    }));

    if (count($timestamps) >= $max) {
        return false;
    }

    $timestamps[] = $now;
    @file_put_contents($file, json_encode($timestamps), LOCK_EX);
    return true;
}

// === Cleanup (batch-limited) ================================================
function nyx_cleanup_expired() {
    $now = time();
    $dir = @opendir(DATA_DIR);
    if (!$dir) return;

    $count = 0;
    while ($count < CLEANUP_BATCH && ($entry = readdir($dir)) !== false) {
        if (substr($entry, -5) !== '.json') continue;

        $f    = DATA_DIR . '/' . $entry;
        $data = json_decode(@file_get_contents($f), true);
        if (!is_array($data)) continue;

        $id = basename($entry, '.json');

        if (isset($data['expires_at']) && $data['expires_at'] < $now) {
            nyx_delete_transfer($id);
            $count++;
        } elseif (
            isset($data['status']) && $data['status'] === 'uploading' &&
            ($data['created_at'] ?? 0) < $now - MAX_UPLOAD_TIME
        ) {
            nyx_delete_transfer($id);
            $count++;
        }
    }
    closedir($dir);

    // Also prune stale rate-limit files (> 2 hours old)
    $rlDir = @opendir(RATE_DIR);
    if ($rlDir) {
        while (($entry = readdir($rlDir)) !== false) {
            if ($entry[0] === '.') continue;
            $f = RATE_DIR . '/' . $entry;
            if (@filemtime($f) < $now - 7200) @unlink($f);
        }
        closedir($rlDir);
    }
}

// Opportunistic cleanup (~2% of requests)
if (mt_rand(1, 50) === 1) {
    nyx_cleanup_expired();
}
