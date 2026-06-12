<?php
// NyxTransfer — non-sensitive metadata for a transfer
require __DIR__ . '/config.php';

$id = nyx_sanitize_id($_GET['id'] ?? '');
if ($id === '') nyx_error('Identifiant manquant');

$meta = nyx_read_meta($id);
if (!$meta)                              nyx_error('Transfert introuvable', 404);
if (($meta['status'] ?? '') !== 'ready') nyx_error('Transfert non disponible', 404);

if (isset($meta['expires_at']) && $meta['expires_at'] < time()) {
    nyx_delete_transfer($id);
    nyx_error('Transfert expiré', 410);
}
if (
    ($meta['max_downloads'] ?? 0) > 0 &&
    ($meta['downloads'] ?? 0) >= $meta['max_downloads']
) {
    nyx_error('Nombre maximal de téléchargements atteint', 410);
}

nyx_json([
    'id'            => $id,
    'size'          => $meta['size'],
    'expires_at'    => $meta['expires_at'],
    'max_downloads' => $meta['max_downloads'],
    'downloads'     => $meta['downloads'],
    'created_at'    => $meta['created_at'],
]);
