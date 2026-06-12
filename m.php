<?php
// NyxTransfer — encrypted message view page
$id = isset($_GET['id']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['id']) : '';
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Message sécurisé &middot; NyxTransfer</title>
    <meta name="theme-color" content="#0a0514">
    <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
    <div class="bg-orb bg-orb-1"></div>
    <div class="bg-orb bg-orb-2"></div>
    <div class="bg-orb bg-orb-3"></div>
    <div class="bg-grid"></div>

    <header class="site-header">
        <a href="index.php" class="logo">
            <svg viewBox="0 0 40 40" width="34" height="34" class="logo-icon" aria-hidden="true">
                <defs>
                    <linearGradient id="logo-grad-m" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#d8b4fe"/>
                        <stop offset="100%" stop-color="#7e22ce"/>
                    </linearGradient>
                    <mask id="logo-crescent-m">
                        <rect width="40" height="40" fill="#fff"/>
                        <circle cx="26" cy="15" r="13" fill="#000"/>
                    </mask>
                </defs>
                <circle cx="20" cy="20" r="15" fill="url(#logo-grad-m)" mask="url(#logo-crescent-m)"/>
                <circle cx="32" cy="7" r="1.8" fill="url(#logo-grad-m)"/>
                <circle cx="36" cy="14" r="1.1" fill="url(#logo-grad-m)" opacity="0.75"/>
            </svg>
            <span class="logo-text">Nyx<span class="logo-accent">Transfer</span></span>
        </a>
    </header>

    <main class="download-hero">
        <div class="download-card" id="messageCard">
            <div class="dl-stage">
                <div class="download-icon">
                    <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
                        <defs>
                            <linearGradient id="loading-grad-m" x1="0%" y1="0%" x2="100%" y2="100%">
                                <stop offset="0%" stop-color="#d8b4fe"/>
                                <stop offset="100%" stop-color="#7e22ce"/>
                            </linearGradient>
                        </defs>
                        <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(168,85,247,0.15)" stroke-width="3"/>
                        <circle cx="32" cy="32" r="26" fill="none" stroke="url(#loading-grad-m)" stroke-width="3" stroke-linecap="round" stroke-dasharray="40 200" class="spinner-arc"/>
                    </svg>
                </div>
                <h2 class="download-title">Vérification</h2>
                <p class="download-subtitle">Chargement des informations du message...</p>
            </div>
        </div>
    </main>

    <footer class="site-footer">
        <p>NyxTransfer &middot; Chiffrement de bout en bout</p>
    </footer>

    <script>
        window.NYX_CONFIG = {
            id: <?php echo json_encode($id); ?>,
            apiMessage: 'api/message.php'
        };
    </script>
    <script src="assets/js/message.js"></script>
</body>
</html>
