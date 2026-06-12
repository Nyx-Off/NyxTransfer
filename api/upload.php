<?php
// NyxTransfer — upload endpoint (init / chunk / finalize / abort)
require __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    exit;
}

$action = $_GET['action'] ?? '';

// --- INIT --------------------------------------------------------------------
if ($action === 'init') {
    $raw  = file_get_contents('php://input');
    $body = json_decode($raw, true);
    if (!is_array($body)) nyx_error('Corps invalide');

    if (!nyx_rate_limit('upload_init')) {
        nyx_error('Trop de requêtes, réessayez plus tard', 429);
    }

    $size         = (int)($body['size'] ?? 0);
    $expiration   = (int)($body['expiration'] ?? 604800);
    $maxDownloads = (int)($body['max_downloads'] ?? 0);

    if ($size <= 0 || $size > MAX_SIZE) {
        nyx_error('Taille invalide');
    }

    $freeSpace = @disk_free_space(STORAGE_DIR);
    if ($freeSpace !== false && $freeSpace < $size * 1.1) {
        nyx_error('Stockage temporairement insuffisant', 503);
    }

    $allowedExp = [3600, 86400, 604800, 2592000];
    if (!in_array($expiration, $allowedExp, true)) $expiration = 604800;
    if ($maxDownloads < 0 || $maxDownloads > 1000) $maxDownloads = 0;

    $id = nyx_generate_id(12);
    while (file_exists(DATA_DIR . '/' . $id . '.json')) {
        $id = nyx_generate_id(12);
    }

    $token = nyx_generate_id(24);

    $now  = time();
    $meta = [
        'id'            => $id,
        'status'        => 'uploading',
        'size'          => $size,
        'uploaded'      => 0,
        'created_at'    => $now,
        'expires_at'    => $now + $expiration,
        'max_downloads' => $maxDownloads,
        'downloads'     => 0,
        'token_hash'    => hash('sha256', $token),
    ];
    nyx_write_meta($id, $meta);

    $tmpInit = nyx_safe_path(TMP_DIR, $id, '.part');
    if (!$tmpInit) nyx_error('Erreur interne', 500);
    file_put_contents($tmpInit, '');

    nyx_json([
        'id'         => $id,
        'token'      => $token,
        'chunk_size' => 5 * 1024 * 1024,
    ]);
}

// --- CHUNK -------------------------------------------------------------------
if ($action === 'chunk') {
    $id    = nyx_sanitize_id($_GET['id'] ?? '');
    $token = (string)($_GET['token'] ?? '');

    if ($id === '' || $token === '') nyx_error('Paramètres manquants');

    $meta = nyx_read_meta($id);
    if (!$meta)                                  nyx_error('Transfert inconnu', 404);
    if (($meta['status'] ?? '') !== 'uploading') nyx_error('Déjà finalisé', 409);
    if (!hash_equals($meta['token_hash'], hash('sha256', $token))) {
        nyx_error('Token invalide', 403);
    }

    $tmpPath = nyx_safe_path(TMP_DIR, $id, '.part');
    if (!$tmpPath || !file_exists($tmpPath)) nyx_error('Fichier temporaire manquant', 404);

    $data = file_get_contents('php://input');
    if ($data === false) nyx_error('Lecture du corps impossible');

    $chunkLen = strlen($data);
    if ($chunkLen === 0)            nyx_error('Chunk vide');
    if ($chunkLen > MAX_CHUNK_SIZE) nyx_error('Chunk trop grand');
    if ($meta['uploaded'] + $chunkLen > $meta['size']) {
        nyx_error('Dépassement de la taille annoncée');
    }

    $fp = fopen($tmpPath, 'ab');
    if (!$fp) nyx_error('Ouverture du fichier impossible');
    if (flock($fp, LOCK_EX)) {
        fwrite($fp, $data);
        fflush($fp);
        flock($fp, LOCK_UN);
    }
    fclose($fp);

    $meta['uploaded'] += $chunkLen;
    nyx_write_meta($id, $meta);

    nyx_json(['ok' => true, 'uploaded' => $meta['uploaded']]);
}

// --- FINALIZE ----------------------------------------------------------------
if ($action === 'finalize') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) nyx_error('Corps invalide');

    $id    = nyx_sanitize_id($body['id'] ?? '');
    $token = (string)($body['token'] ?? '');
    if ($id === '' || $token === '') nyx_error('Paramètres manquants');

    $meta = nyx_read_meta($id);
    if (!$meta)                                  nyx_error('Transfert inconnu', 404);
    if (($meta['status'] ?? '') !== 'uploading') nyx_error('Déjà finalisé', 409);
    if (!hash_equals($meta['token_hash'], hash('sha256', $token))) {
        nyx_error('Token invalide', 403);
    }

    $tmpPath   = nyx_safe_path(TMP_DIR, $id, '.part');
    $finalPath = nyx_safe_path(STORAGE_DIR, $id, '.bin');
    if (!$tmpPath || !$finalPath) nyx_error('Identifiant invalide', 400);

    if (!file_exists($tmpPath)) nyx_error('Fichier temporaire manquant', 404);
    clearstatcache(true, $tmpPath);
    if (filesize($tmpPath) !== $meta['size']) {
        nyx_error('Taille finale incorrecte');
    }

    if (!rename($tmpPath, $finalPath)) {
        nyx_error('Finalisation impossible');
    }

    $meta['status'] = 'ready';
    unset($meta['token_hash']);
    nyx_write_meta($id, $meta);

    nyx_json(['ok' => true, 'id' => $id]);
}

// --- ABORT -------------------------------------------------------------------
if ($action === 'abort') {
    $body = json_decode(file_get_contents('php://input'), true);
    if (!is_array($body)) nyx_error('Corps invalide');

    $id    = nyx_sanitize_id($body['id'] ?? '');
    $token = (string)($body['token'] ?? '');

    $meta = nyx_read_meta($id);
    if (!$meta) nyx_json(['ok' => true]);
    if (
        ($meta['status'] ?? '') === 'uploading' &&
        hash_equals($meta['token_hash'] ?? '', hash('sha256', $token))
    ) {
        nyx_delete_transfer($id);
    }
    nyx_json(['ok' => true]);
}

nyx_error('Action inconnue');
