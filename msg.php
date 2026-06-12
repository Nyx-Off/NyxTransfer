<?php
// NyxTransfer — encrypted message sending page
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NyxTransfer — Message chiffré</title>
    <meta name="description" content="Envoyez des messages chiffrés de bout en bout. Mots de passe, notes confidentielles, zero-knowledge.">
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
                    <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stop-color="#d8b4fe"/>
                        <stop offset="100%" stop-color="#7e22ce"/>
                    </linearGradient>
                    <mask id="logo-crescent">
                        <rect width="40" height="40" fill="#fff"/>
                        <circle cx="26" cy="15" r="13" fill="#000"/>
                    </mask>
                </defs>
                <circle cx="20" cy="20" r="15" fill="url(#logo-grad)" mask="url(#logo-crescent)"/>
                <circle cx="32" cy="7" r="1.8" fill="url(#logo-grad)"/>
                <circle cx="36" cy="14" r="1.1" fill="url(#logo-grad)" opacity="0.75"/>
            </svg>
            <span class="logo-text">Nyx<span class="logo-accent">Transfer</span></span>
        </a>
        <nav class="site-nav">
            <a href="index.php" class="nav-link">Fichiers</a>
            <a href="#security" class="nav-link">Sécurité</a>
        </nav>
    </header>

    <main class="main">
        <section class="hero">
            <div class="hero-content">
                <div class="hero-badge">
                    <span class="hero-badge-dot"></span>
                    Chiffrement de bout en bout
                </div>
                <h1 class="hero-title">
                    Chiffrez.<br>
                    <span class="gradient-text">Vos messages.</span>
                </h1>
                <p class="hero-subtitle">
                    Partagez mots de passe, notes confidentielles ou tout texte sensible.
                    Chiffrement AES-256 dans votre navigateur &mdash; le serveur ne voit rien.
                </p>
                <div class="hero-stats">
                    <div class="hero-stat">
                        <span class="hero-stat-value">AES-256</span>
                        <span class="hero-stat-label">GCM</span>
                    </div>
                    <div class="hero-stat-divider"></div>
                    <div class="hero-stat">
                        <span class="hero-stat-value">Zéro</span>
                        <span class="hero-stat-label">connaissance</span>
                    </div>
                    <div class="hero-stat-divider"></div>
                    <div class="hero-stat">
                        <span class="hero-stat-value">50k</span>
                        <span class="hero-stat-label">caractères</span>
                    </div>
                </div>
            </div>

            <div class="upload-card" id="msgCard">
                <!-- Stage: input -->
                <div class="stage stage-input" id="stageInput">
                    <div class="message-input">
                        <textarea id="messageText" class="message-textarea" placeholder="Votre message confidentiel, mot de passe, note secrète..." maxlength="50000"></textarea>
                        <div class="message-counter"><span id="charCount">0</span> / 50 000</div>
                    </div>

                    <div class="upload-options">
                        <label class="option">
                            <span class="option-label">Expiration</span>
                            <select id="expirationSelect" class="option-input">
                                <option value="3600">1 heure</option>
                                <option value="86400" selected>1 jour</option>
                                <option value="604800">7 jours</option>
                                <option value="2592000">30 jours</option>
                            </select>
                        </label>
                        <label class="option">
                            <span class="option-label">Consultations max</span>
                            <select id="maxViewsSelect" class="option-input">
                                <option value="0">Illimité</option>
                                <option value="1" selected>1 fois</option>
                                <option value="5">5 fois</option>
                                <option value="10">10 fois</option>
                                <option value="50">50 fois</option>
                            </select>
                        </label>
                    </div>

                    <div class="stage-actions" id="stageActions" hidden>
                        <button type="button" class="btn btn-secondary" id="clearBtn">Effacer</button>
                        <button type="button" class="btn btn-primary" id="sendBtn">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                            </svg>
                            <span>Chiffrer et envoyer</span>
                        </button>
                    </div>
                </div>

                <!-- Stage: sending -->
                <div class="stage stage-uploading" id="stageSending" hidden>
                    <div class="upload-spinner">
                        <svg viewBox="0 0 64 64" width="80" height="80" aria-hidden="true">
                            <defs>
                                <linearGradient id="spin-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stop-color="#d8b4fe"/>
                                    <stop offset="100%" stop-color="#7e22ce"/>
                                </linearGradient>
                            </defs>
                            <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(168,85,247,0.15)" stroke-width="3"/>
                            <circle cx="32" cy="32" r="26" fill="none" stroke="url(#spin-grad)" stroke-width="3" stroke-linecap="round" stroke-dasharray="40 200" class="spinner-arc"/>
                        </svg>
                    </div>
                    <div class="progress-status" id="progressStatus">Chiffrement...</div>
                    <div class="progress-bar">
                        <div class="progress-fill" id="progressFill"></div>
                    </div>
                    <div class="progress-detail" id="progressDetail">0%</div>
                </div>

                <!-- Stage: success -->
                <div class="stage stage-success" id="stageSuccess" hidden>
                    <div class="success-icon">
                        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
                            <defs>
                                <linearGradient id="success-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" stop-color="#d8b4fe"/>
                                    <stop offset="100%" stop-color="#7e22ce"/>
                                </linearGradient>
                            </defs>
                            <circle cx="32" cy="32" r="28" fill="none" stroke="url(#success-grad)" stroke-width="3"/>
                            <path d="M20 32 L28 40 L44 24" fill="none" stroke="url(#success-grad)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" class="check-path"/>
                        </svg>
                    </div>
                    <h3 class="success-title">Prêt à partager</h3>
                    <p class="success-subtitle">Voici votre lien sécurisé. La clé est dans le fragment <code>#</code>.</p>
                    <div class="link-box">
                        <input type="text" id="shareLink" class="link-input" readonly>
                        <button type="button" class="btn btn-icon-only" id="copyBtn" title="Copier le lien">
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                        </button>
                    </div>
                    <div class="share-info" id="shareInfo"></div>
                    <button type="button" class="btn btn-ghost" id="newMsgBtn">+ Nouveau message</button>
                </div>

                <!-- Stage: error -->
                <div class="stage stage-error" id="stageError" hidden>
                    <div class="error-icon">
                        <svg viewBox="0 0 64 64" width="60" height="60" aria-hidden="true">
                            <circle cx="32" cy="32" r="28" fill="none" stroke="#f87171" stroke-width="3"/>
                            <path d="M22 22 L42 42 M42 22 L22 42" stroke="#f87171" stroke-width="3.5" stroke-linecap="round"/>
                        </svg>
                    </div>
                    <h3 class="error-title">Une erreur est survenue</h3>
                    <p class="error-message" id="errorMessage"></p>
                    <button type="button" class="btn btn-primary" id="retryBtn">Réessayer</button>
                </div>
            </div>
        </section>

        <section class="features" id="how">
            <div class="section-head">
                <h2 class="section-title">Comment ça marche</h2>
                <p class="section-sub">Trois étapes, aucune confiance requise.</p>
            </div>
            <div class="feature-grid">
                <div class="feature">
                    <div class="feature-num">01</div>
                    <h3>Rédigez</h3>
                    <p>Tapez votre message, mot de passe ou note confidentielle dans la zone sécurisée.</p>
                </div>
                <div class="feature">
                    <div class="feature-num">02</div>
                    <h3>Chiffrement local</h3>
                    <p>Votre texte est chiffré en AES-256-GCM directement dans votre navigateur. La clé ne quitte jamais votre appareil.</p>
                </div>
                <div class="feature">
                    <div class="feature-num">03</div>
                    <h3>Partagez le lien</h3>
                    <p>Un lien unique est généré. Le message s'autodétruit après consultation si vous le souhaitez.</p>
                </div>
            </div>
        </section>

        <section class="security" id="security">
            <div class="section-head">
                <h2 class="section-title">Modèle zero-knowledge</h2>
                <p class="section-sub">Le serveur stocke des octets, pas des messages.</p>
            </div>
            <div class="security-content">
                <p>NyxTransfer applique un modèle <strong>zero-knowledge</strong>. Le serveur ne reçoit que des blobs chiffrés &mdash; sans contenu, sans métadonnée parlante. Même l'administrateur du service ne peut pas lire vos messages.</p>
                <ul class="security-list">
                    <li><strong>AES-256-GCM</strong> &mdash; Chiffrement authentifié de niveau militaire, intégrité garantie.</li>
                    <li><strong>Web Crypto API</strong> &mdash; Primitives natives du navigateur, aucune dépendance tierce.</li>
                    <li><strong>Clé dans le fragment</strong> &mdash; Le <code>#</code> de l'URL n'est jamais envoyé au serveur, par conception HTTP.</li>
                    <li><strong>Autodestruction</strong> &mdash; Configurez une consultation unique pour que le message disparaisse après lecture.</li>
                    <li><strong>Aucun compte</strong> &mdash; Aucune trace, aucun journal nominatif.</li>
                </ul>
            </div>
        </section>
    </main>

    <footer class="site-footer">
        <p>NyxTransfer &middot; Chiffrement de bout en bout</p>
    </footer>

    <script>
        window.NYX_CONFIG = {
            apiMessage: 'api/message.php',
            baseUrl: (function(){
                var p = window.location.pathname;
                return p.substring(0, p.lastIndexOf('/') + 1);
            })()
        };
    </script>
    <script src="assets/js/msg-send.js"></script>
</body>
</html>
