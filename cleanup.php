<?php
// NyxTransfer — cron-friendly cleanup script
// Run periodically (e.g. every hour) to delete expired transfers.
require __DIR__ . '/api/config.php';

$before = count(glob(DATA_DIR . '/*.json') ?: []);
nyx_cleanup_expired();
$after  = count(glob(DATA_DIR . '/*.json') ?: []);

echo "NyxTransfer cleanup: $before → $after transfers" . PHP_EOL;
