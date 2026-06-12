/* NyxTransfer — message sending page logic
 * Client-side AES-256-GCM encryption with key in URL fragment.
 * DOM is built exclusively via createElement/textContent — no unsafe HTML injection.
 */
(function () {
    'use strict';

    var cfg = window.NYX_CONFIG;

    var els = {
        stageInput:       document.getElementById('stageInput'),
        stageSending:     document.getElementById('stageSending'),
        stageSuccess:     document.getElementById('stageSuccess'),
        stageError:       document.getElementById('stageError'),
        messageText:      document.getElementById('messageText'),
        charCount:        document.getElementById('charCount'),
        expirationSelect: document.getElementById('expirationSelect'),
        maxViewsSelect:   document.getElementById('maxViewsSelect'),
        stageActions:     document.getElementById('stageActions'),
        sendBtn:          document.getElementById('sendBtn'),
        clearBtn:         document.getElementById('clearBtn'),
        progressFill:     document.getElementById('progressFill'),
        progressDetail:   document.getElementById('progressDetail'),
        progressStatus:   document.getElementById('progressStatus'),
        shareLink:        document.getElementById('shareLink'),
        copyBtn:          document.getElementById('copyBtn'),
        shareInfo:        document.getElementById('shareInfo'),
        newMsgBtn:        document.getElementById('newMsgBtn'),
        errorMessage:     document.getElementById('errorMessage'),
        retryBtn:         document.getElementById('retryBtn')
    };

    // === Stage management ===================================================
    function setStage(name) {
        [els.stageInput, els.stageSending, els.stageSuccess, els.stageError]
            .forEach(function (el) { el.hidden = true; });
        var map = {
            input:   els.stageInput,
            sending: els.stageSending,
            success: els.stageSuccess,
            error:   els.stageError
        };
        map[name].hidden = false;
    }

    // === Text input ==========================================================
    els.messageText.addEventListener('input', function () {
        var count = els.messageText.value.length;
        els.charCount.textContent = count.toLocaleString('fr-FR');
        els.stageActions.hidden = !els.messageText.value.trim();
    });

    els.clearBtn.addEventListener('click', function () {
        els.messageText.value = '';
        els.charCount.textContent = '0';
        els.stageActions.hidden = true;
    });

    els.sendBtn.addEventListener('click', function () {
        startSend().catch(function (err) {
            console.error(err);
            showError(err && err.message ? err.message : 'Erreur inconnue');
        });
    });

    els.newMsgBtn.addEventListener('click', function () {
        els.messageText.value = '';
        els.charCount.textContent = '0';
        els.stageActions.hidden = true;
        setStage('input');
    });

    els.retryBtn.addEventListener('click', function () { setStage('input'); });

    els.copyBtn.addEventListener('click', async function () {
        try {
            await navigator.clipboard.writeText(els.shareLink.value);
            showToast('Lien copié dans le presse-papiers');
        } catch (e) {
            els.shareLink.select();
            document.execCommand('copy');
            showToast('Lien copié');
        }
    });

    // === Send flow ===========================================================
    async function startSend() {
        var text = els.messageText.value.trim();
        if (!text) return;

        setStage('sending');
        setProgress(10, 'Chiffrement...');

        // Generate AES-256 key
        var cryptoKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 }, true, ['encrypt']
        );
        var rawKey = await crypto.subtle.exportKey('raw', cryptoKey);
        var keyB64 = bytesToB64Url(new Uint8Array(rawKey));

        // Encrypt: [12B IV][ciphertext + 16B GCM tag]
        var iv = crypto.getRandomValues(new Uint8Array(12));
        var plaintext = new TextEncoder().encode(text);
        var ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv }, cryptoKey, plaintext
        );

        var blob = new Uint8Array(iv.byteLength + ct.byteLength);
        blob.set(iv, 0);
        blob.set(new Uint8Array(ct), iv.byteLength);

        // Base64 encode for JSON transport
        var b64 = '';
        for (var i = 0; i < blob.length; i++) b64 += String.fromCharCode(blob[i]);
        b64 = btoa(b64);

        setProgress(50, 'Envoi...');

        var res = await fetch(cfg.apiMessage + '?action=create', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                data:       b64,
                expiration: parseInt(els.expirationSelect.value, 10),
                max_views:  parseInt(els.maxViewsSelect.value, 10)
            })
        });
        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.error || 'Erreur lors de l\'envoi');
        }
        var data = await res.json();

        setProgress(100, 'Terminé');
        showSuccess(data.id, keyB64);
    }

    // === UI helpers ==========================================================
    function setProgress(percent, status) {
        var p = Math.min(100, Math.max(0, percent));
        els.progressFill.style.width = p + '%';
        if (status) els.progressStatus.textContent = status;
        els.progressDetail.textContent = Math.round(p) + '%';
    }

    function showError(msg) {
        els.errorMessage.textContent = msg;
        setStage('error');
    }

    function showSuccess(id, keyB64) {
        var url = window.location.origin + cfg.baseUrl + 'm.php?id=' + encodeURIComponent(id) + '#' + keyB64;
        els.shareLink.value = url;

        var expiration = parseInt(els.expirationSelect.value, 10);
        var maxViews   = parseInt(els.maxViewsSelect.value, 10);
        var expTxt     = formatDuration(expiration);
        var viewTxt    = maxViews === 0
            ? 'consultations illimitées'
            : maxViews + ' consultation' + (maxViews > 1 ? 's' : '');
        els.shareInfo.textContent = 'Expire dans ' + expTxt + ' · ' + viewTxt;

        setStage('success');
        setTimeout(function () {
            els.shareLink.focus();
            els.shareLink.select();
        }, 200);
    }

    function formatDuration(seconds) {
        if (seconds < 3600)  return Math.round(seconds / 60) + ' min';
        if (seconds < 86400) return Math.round(seconds / 3600) + ' h';
        return Math.round(seconds / 86400) + ' j';
    }

    function bytesToB64Url(bytes) {
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    var toastEl    = null;
    var toastTimer = null;
    function showToast(msg) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.className = 'toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        // eslint-disable-next-line no-unused-expressions
        toastEl.offsetHeight;
        toastEl.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
    }

    // === Boot ================================================================
    if (!window.crypto || !window.crypto.subtle) {
        showError('Votre navigateur ne supporte pas l\'API Web Crypto. Utilisez Chrome, Firefox, Safari ou Edge récents.');
        if (els.sendBtn) els.sendBtn.disabled = true;
    }
})();
