<?php
// NyxTransfer — encrypted message endpoint (create / info / fetch)
require __DIR__ . '/config.php';

define('MAX_MSG_SIZE', 100 * 1024); // 100 KB encrypted max (~50 KB plaintext)

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    exit;
}

$action = $_GET['action'] ?? '';

// --- CREATE ------------------------------------------------------------------
if ($action === 'create') {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) nyx_error('Corps invalide');

    if (!nyx_rate_limit('msg_create', RATE_LIMIT_INIT)) {
        nyx_error('Trop de requêtes, réessayez plus tard', 429);
    }

    $data       = (string)($body['data'] ?? '');
    $expiration = (int)($body['expiration'] ?? 86400);
    $maxViews   = (int)($body['max_views'] ?? 0);

    if ($data === '' || strlen($data) > MAX_MSG_SIZE) {
        nyx_error('Message invalide ou trop long');
    }

    // Validate base64 encoding
    if (!preg_match('/^[A-Za-z0-9+\/=]+$/', $data)) {
        nyx_error('Données invalides');
    }

    $allowedExp = [3600, 86400, 604800, 2592000];
    if (!in_array($expiration, $allowedExp, true)) $expiration = 86400;
    if ($maxViews < 0 || $maxViews > 1000) $maxViews = 0;

    $id = nyx_generate_id(12);
    while (file_exists(DATA_DIR . '/' . $id . '.json')) {
        $id = nyx_generate_id(12);
    }

    $now  = time();
    $meta = [
        'id'             => $id,
        'type'           => 'message',
        'status'         => 'ready',
        'encrypted_data' => $data,
        'size'           => strlen($data),
        'created_at'     => $now,
        'expires_at'     => $now + $expiration,
        'max_views'      => $maxViews,
        'views'          => 0,
    ];
    nyx_write_meta($id, $meta);

    nyx_json(['id' => $id]);
}

// --- INFO --------------------------------------------------------------------
if ($action === 'info') {
    $id = nyx_sanitize_id($_GET['id'] ?? '');
    if ($id === '') nyx_error('Identifiant manquant');

    $meta = nyx_read_meta($id);
    if (!$meta || ($meta['type'] ?? '') !== 'message')  nyx_error('Message introuvable', 404);
    if (($meta['status'] ?? '') !== 'ready')             nyx_error('Message non disponible', 404);

    if (isset($meta['expires_at']) && $meta['expires_at'] < time()) {
        nyx_delete_transfer($id);
        nyx_error('Message expiré', 410);
    }
    if (($meta['max_views'] ?? 0) > 0 && ($meta['views'] ?? 0) >= $meta['max_views']) {
        nyx_error('Nombre maximal de consultations atteint', 410);
    }

    nyx_json([
        'id'         => $id,
        'size'       => $meta['size'],
        'expires_at' => $meta['expires_at'],
        'max_views'  => $meta['max_views'],
        'views'      => $meta['views'],
        'created_at' => $meta['created_at'],
    ]);
}

// --- FETCH -------------------------------------------------------------------
if ($action === 'fetch') {
    $id = nyx_sanitize_id($_GET['id'] ?? '');
    if ($id === '') nyx_error('Identifiant manquant');

    // Atomic counter update under exclusive lock (same pattern as download.php)
    $lockPath = nyx_safe_path(DATA_DIR, $id, '.lock');
    if (!$lockPath) nyx_error('Identifiant invalide', 400);
    $lockFp   = @fopen($lockPath, 'c');
    if (!$lockFp || !flock($lockFp, LOCK_EX)) {
        nyx_error('Réessayez', 503);
    }

    $meta = nyx_read_meta($id);

    $fail    = null;
    $failMsg = '';
    if (!$meta || ($meta['type'] ?? '') !== 'message' || ($meta['status'] ?? '') !== 'ready') {
        $fail = 404; $failMsg = 'Message introuvable';
    } elseif (isset($meta['expires_at']) && $meta['expires_at'] < time()) {
        nyx_delete_transfer($id);
        $fail = 410; $failMsg = 'Message expiré';
    } elseif (($meta['max_views'] ?? 0) > 0 && ($meta['views'] ?? 0) >= $meta['max_views']) {
        $fail = 410; $failMsg = 'Nombre maximal de consultations atteint';
    }

    if ($fail !== null) {
        flock($lockFp, LOCK_UN);
        fclose($lockFp);
        nyx_error($failMsg, $fail);
    }

    $meta['views'] = ($meta['views'] ?? 0) + 1;
    nyx_write_meta($id, $meta);

    $shouldDelete = (
        ($meta['max_views'] ?? 0) > 0 &&
        $meta['views'] >= $meta['max_views']
    );

    $data = $meta['encrypted_data'];

    flock($lockFp, LOCK_UN);
    fclose($lockFp);

    if ($shouldDelete) {
        nyx_delete_transfer($id);
    }

    nyx_json(['data' => $data]);
}

nyx_error('Action inconnue');
