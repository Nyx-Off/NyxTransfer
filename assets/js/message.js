/* NyxTransfer — message view page logic
 * Decrypts a text message using the AES-256-GCM key from the URL fragment.
 * DOM is built exclusively via createElement/textContent — no unsafe HTML injection.
 */
(function () {
    'use strict';

    var cfg  = window.NYX_CONFIG;
    var card = document.getElementById('messageCard');

    // === Safe DOM helpers ===================================================
    function clearChildren(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function svgFromString(str) {
        var doc = new DOMParser().parseFromString(str, 'image/svg+xml');
        return document.importNode(doc.documentElement, true);
    }

    function el(tag, attrs) {
        var e = document.createElement(tag);
        if (attrs) {
            for (var k in attrs) {
                var v = attrs[k];
                if (v == null) continue;
                if      (k === 'class')  e.className = v;
                else if (k === 'style')  e.style.cssText = v;
                else if (k === 'text')   e.textContent = v;
                else if (k.startsWith('on') && typeof v === 'function') {
                    e.addEventListener(k.substring(2).toLowerCase(), v);
                } else {
                    e.setAttribute(k, v);
                }
            }
        }
        for (var i = 2; i < arguments.length; i++) {
            var c = arguments[i];
            if (c == null || c === false) continue;
            e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
        return e;
    }

    // === Trusted static SVG strings =========================================
    var SVG_ERROR =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="60" height="60">' +
        '<circle cx="32" cy="32" r="28" fill="none" stroke="#f87171" stroke-width="3"/>' +
        '<path d="M22 22 L42 42 M42 22 L22 42" stroke="#f87171" stroke-width="3.5" stroke-linecap="round"/>' +
        '</svg>';

    var SVG_LOCK =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">' +
        '<defs><linearGradient id="lg-lock-m" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#d8b4fe"/><stop offset="100%" stop-color="#7e22ce"/>' +
        '</linearGradient></defs>' +
        '<rect x="14" y="28" width="36" height="28" rx="4" fill="none" stroke="url(#lg-lock-m)" stroke-width="3"/>' +
        '<path d="M21 28 L21 20 A11 11 0 0 1 43 20 L43 28" fill="none" stroke="url(#lg-lock-m)" stroke-width="3"/>' +
        '<circle cx="32" cy="40" r="3.5" fill="url(#lg-lock-m)"/>' +
        '<line x1="32" y1="43" x2="32" y2="49" stroke="url(#lg-lock-m)" stroke-width="3.5" stroke-linecap="round"/>' +
        '</svg>';

    var SVG_CHECK =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="60" height="60">' +
        '<defs><linearGradient id="lg-ok-m" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#d8b4fe"/><stop offset="100%" stop-color="#7e22ce"/>' +
        '</linearGradient></defs>' +
        '<circle cx="32" cy="32" r="28" fill="none" stroke="url(#lg-ok-m)" stroke-width="3"/>' +
        '<path d="M20 32 L28 40 L44 24" fill="none" stroke="url(#lg-ok-m)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" class="check-path"/>' +
        '</svg>';

    var SVG_COPY =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
        '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>' +
        '</svg>';

    // === Helpers =============================================================
    function formatTimeLeft(expiresAt) {
        var delta = expiresAt - (Date.now() / 1000);
        if (delta < 0)     return 'expiré';
        if (delta < 3600)  return Math.max(1, Math.round(delta / 60)) + ' min';
        if (delta < 86400) return Math.round(delta / 3600) + ' h';
        return Math.round(delta / 86400) + ' j';
    }

    function b64UrlToBytes(b64url) {
        var b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        var bin = atob(b64);
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function swap(node) {
        clearChildren(card);
        card.appendChild(node);
    }

    // === Stages =============================================================
    function showError(title, msg) {
        swap(el('div', { class: 'dl-stage' },
            el('div', { class: 'error-icon' }, svgFromString(SVG_ERROR)),
            el('h2',  { class: 'download-title', text: title }),
            el('p',   { class: 'download-subtitle', text: msg }),
            el('a', {
                href:  'index.php',
                class: 'btn btn-primary',
                style: 'display:inline-flex;text-decoration:none;flex:0',
                text:  'Retour à l\'accueil'
            })
        ));
    }

    function showInfo(info, keyBytes) {
        var timeLeft  = formatTimeLeft(info.expires_at);
        var remaining = info.max_views > 0 ? (info.max_views - info.views) : null;

        var dlBtn = el('button', {
            type:  'button',
            class: 'btn btn-primary',
            style: 'width:100%;flex:0'
        }, svgFromString(SVG_LOCK), document.createTextNode(' Déchiffrer le message'));

        dlBtn.addEventListener('click', function () {
            fetchAndDecrypt(info, keyBytes).catch(function (err) {
                console.error(err);
                showError('Erreur', err && err.message ? err.message : 'Déchiffrement échoué');
            });
        });

        var meta = el('div', { class: 'download-meta' },
            el('div', { class: 'meta-item' },
                el('span', { class: 'meta-label', text: 'Expire' }),
                el('span', { class: 'meta-value', text: timeLeft })
            ),
            el('div', { class: 'meta-item' },
                el('span', { class: 'meta-label', text: 'Consultations restantes' }),
                el('span', { class: 'meta-value', text: remaining === null ? '\u221E' : String(remaining) })
            )
        );

        swap(el('div', { class: 'dl-stage' },
            el('div', { class: 'download-icon' }, svgFromString(SVG_LOCK)),
            el('h2',  { class: 'download-title', text: 'Message chiffré' }),
            el('p',   { class: 'download-subtitle', text: 'Prêt à être déchiffré dans votre navigateur' }),
            meta,
            dlBtn
        ));
    }

    function showMessage(text) {
        var textarea = el('textarea', {
            class:    'message-display',
            readonly: 'readonly'
        });
        textarea.value = text;

        var copyBtn = el('button', {
            type:  'button',
            class: 'btn btn-secondary',
            style: 'width:100%;flex:0;margin-top:12px'
        }, svgFromString(SVG_COPY), document.createTextNode(' Copier le message'));

        copyBtn.addEventListener('click', function () {
            navigator.clipboard.writeText(text).then(function () {
                clearChildren(copyBtn);
                copyBtn.appendChild(document.createTextNode('Copié !'));
                setTimeout(function () {
                    clearChildren(copyBtn);
                    copyBtn.appendChild(svgFromString(SVG_COPY));
                    copyBtn.appendChild(document.createTextNode(' Copier le message'));
                }, 2000);
            }).catch(function () {
                textarea.select();
                document.execCommand('copy');
            });
        });

        swap(el('div', { class: 'dl-stage' },
            el('div', { class: 'success-icon' }, svgFromString(SVG_CHECK)),
            el('h2',  { class: 'download-title', text: 'Message déchiffré' }),
            textarea,
            copyBtn,
            el('a', {
                href:  'index.php',
                class: 'btn btn-ghost',
                style: 'text-decoration:none;margin-top:8px',
                text:  '+ Nouveau message'
            })
        ));
    }

    // === Fetch + decrypt ====================================================
    async function fetchAndDecrypt(info, keyBytes) {
        var cryptoKey = await crypto.subtle.importKey(
            'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
        );

        var res = await fetch(cfg.apiMessage + '?action=fetch&id=' + encodeURIComponent(info.id));
        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.error || 'Impossible de récupérer le message');
        }
        var body = await res.json();

        // Decode base64 → bytes
        var raw   = atob(body.data);
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

        // [12B IV][ciphertext + 16B GCM tag]
        if (bytes.byteLength < 28) throw new Error('Données invalides');
        var iv = bytes.slice(0, 12);
        var ct = bytes.slice(12);

        var plain;
        try {
            plain = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                cryptoKey,
                ct
            );
        } catch (e) {
            throw new Error('Clé invalide ou message corrompu');
        }

        var text = new TextDecoder().decode(plain);
        showMessage(text);
    }

    // === Boot ===============================================================
    async function main() {
        if (!window.crypto || !window.crypto.subtle) {
            showError('Navigateur non supporté',
                'L\'API Web Crypto est requise pour déchiffrer ce message');
            return;
        }
        if (!cfg.id) {
            showError('Lien invalide', 'Aucun identifiant dans l\'URL');
            return;
        }

        var frag = window.location.hash.substring(1);
        if (!frag) {
            showError('Clé manquante',
                'Le lien ne contient pas la clé de déchiffrement (#\u2026)');
            return;
        }

        var keyBytes;
        try {
            keyBytes = b64UrlToBytes(frag);
            if (keyBytes.length !== 32) throw new Error('bad length');
        } catch (e) {
            showError('Clé invalide', 'Format de clé non reconnu');
            return;
        }

        try {
            var res = await fetch(cfg.apiMessage + '?action=info&id=' + encodeURIComponent(cfg.id));
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                if (res.status === 404) {
                    showError('Message introuvable',
                        'Ce message n\'existe pas ou a été supprimé');
                } else if (res.status === 410) {
                    showError('Message expiré',
                        err.error || 'Ce lien n\'est plus valable');
                } else {
                    showError('Erreur',
                        err.error || 'Impossible de charger le message');
                }
                return;
            }
            var info = await res.json();
            showInfo(info, keyBytes);
        } catch (e) {
            showError('Erreur réseau', e.message || 'Impossible de joindre le serveur');
        }
    }

    main();
})();
