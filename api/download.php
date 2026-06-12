<?php
// NyxTransfer — serves the encrypted blob (atomic download counter via flock)
require __DIR__ . '/config.php';

$id = nyx_sanitize_id($_GET['id'] ?? '');
if ($id === '') { http_response_code(400); exit; }

$filePath = nyx_safe_path(STORAGE_DIR, $id, '.bin');
if (!$filePath || !file_exists($filePath)) { http_response_code(404); exit; }

$lockPath = nyx_safe_path(DATA_DIR, $id, '.lock');
if (!$lockPath) { http_response_code(400); exit; }
$lockFp   = @fopen($lockPath, 'c');
if (!$lockFp || !flock($lockFp, LOCK_EX)) {
    http_response_code(503);
    exit;
}

$meta = nyx_read_meta($id);

$fail = null;
if (!$meta || ($meta['status'] ?? '') !== 'ready') {
    $fail = 404;
} elseif (isset($meta['expires_at']) && $meta['expires_at'] < time()) {
    nyx_delete_transfer($id);
    $fail = 410;
} elseif (
    ($meta['max_downloads'] ?? 0) > 0 &&
    ($meta['downloads'] ?? 0) >= $meta['max_downloads']
) {
    $fail = 410;
}

if ($fail !== null) {
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    http_response_code($fail);
    exit;
}

$meta['downloads'] = ($meta['downloads'] ?? 0) + 1;
nyx_write_meta($id, $meta);

$shouldDelete = (
    ($meta['max_downloads'] ?? 0) > 0 &&
    $meta['downloads'] >= $meta['max_downloads']
);

flock($lockFp, LOCK_UN);
fclose($lockFp);

// --- Stream the encrypted blob ---
nyx_security_headers();
header('Content-Type: application/octet-stream');
header('Content-Length: ' . filesize($filePath));
header('Content-Disposition: attachment; filename="' . $id . '.nyx"');
header('Cache-Control: no-store');
header('X-Accel-Buffering: no');

while (ob_get_level()) ob_end_clean();

$fp = fopen($filePath, 'rb');
if (!$fp) { http_response_code(500); exit; }
fpassthru($fp);
fclose($fp);

// Clean up after last allowed download
if ($shouldDelete) {
    nyx_delete_transfer($id);
}
