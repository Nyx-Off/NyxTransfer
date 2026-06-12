/* NyxTransfer — download page logic
 * Streams the encrypted blob via ReadableStream, decrypts chunk-by-chunk locally
 * with the key from the URL fragment. Memory is bounded (~70 MB peak) regardless
 * of total file size, so 15 GB downloads work without issue.
 * DOM is built exclusively via createElement/textContent — no unsafe HTML injection.
 */
(function () {
    'use strict';

    const cfg  = window.NYX_CONFIG;
    const card = document.getElementById('downloadCard');

    // === Streaming format constants =========================================
    const STREAM_MAGIC    = 0x4E595853; // 'NYXS'
    const STREAM_VERSION  = 2;
    const HEADER_SIZE     = 16;
    const IV_LEN          = 12;
    const LEN_LEN         = 4;
    const MAX_CHUNK_CT    = 64 * 1024 * 1024;  // sanity cap on single ciphertext
    const BLOB_FLUSH_SIZE = 64 * 1024 * 1024;  // flush pending slices to Blob every 64 MB

    // === Safe DOM helpers ===================================================
    function clearChildren(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function svgFromString(str) {
        const doc = new DOMParser().parseFromString(str, 'image/svg+xml');
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
                else if (k === 'dataset'){ for (var d in v) e.dataset[d] = v[d]; }
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
            if (Array.isArray(c)) {
                c.forEach(function (sub) {
                    if (sub == null || sub === false) return;
                    e.appendChild(typeof sub === 'string' ? document.createTextNode(sub) : sub);
                });
            } else {
                e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
            }
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
        '<defs><linearGradient id="lg-lock" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#d8b4fe"/><stop offset="100%" stop-color="#7e22ce"/>' +
        '</linearGradient></defs>' +
        '<rect x="14" y="28" width="36" height="28" rx="4" fill="none" stroke="url(#lg-lock)" stroke-width="3"/>' +
        '<path d="M21 28 L21 20 A11 11 0 0 1 43 20 L43 28" fill="none" stroke="url(#lg-lock)" stroke-width="3"/>' +
        '<circle cx="32" cy="40" r="3.5" fill="url(#lg-lock)"/>' +
        '<line x1="32" y1="43" x2="32" y2="49" stroke="url(#lg-lock)" stroke-width="3.5" stroke-linecap="round"/>' +
        '</svg>';

    var SVG_SPINNER =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="80" height="80">' +
        '<defs><linearGradient id="lg-sp" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#d8b4fe"/><stop offset="100%" stop-color="#7e22ce"/>' +
        '</linearGradient></defs>' +
        '<circle cx="32" cy="32" r="26" fill="none" stroke="rgba(168,85,247,0.15)" stroke-width="3"/>' +
        '<circle cx="32" cy="32" r="26" fill="none" stroke="url(#lg-sp)" stroke-width="3" stroke-linecap="round" stroke-dasharray="40 200" class="spinner-arc"/>' +
        '</svg>';

    var SVG_CHECK =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="60" height="60">' +
        '<defs><linearGradient id="lg-ok" x1="0%" y1="0%" x2="100%" y2="100%">' +
        '<stop offset="0%" stop-color="#d8b4fe"/><stop offset="100%" stop-color="#7e22ce"/>' +
        '</linearGradient></defs>' +
        '<circle cx="32" cy="32" r="28" fill="none" stroke="url(#lg-ok)" stroke-width="3"/>' +
        '<path d="M20 32 L28 40 L44 24" fill="none" stroke="url(#lg-ok)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" class="check-path"/>' +
        '</svg>';

    var SVG_FILE =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/>' +
        '</svg>';

    var SVG_DOWNLOAD_BTN =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" ' +
        'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<polyline points="7 10 12 15 17 10"/>' +
        '<line x1="12" y1="15" x2="12" y2="3"/>' +
        '</svg>';

    var SVG_DOWNLOAD_SMALL =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
        '<polyline points="7 10 12 15 17 10"/>' +
        '<line x1="12" y1="15" x2="12" y2="3"/>' +
        '</svg>';

    // === Formatting =========================================================
    function formatSize(bytes) {
        if (bytes < 1024)               return bytes + ' o';
        if (bytes < 1024 * 1024)        return (bytes / 1024).toFixed(1) + ' Ko';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' Go';
    }

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

    // === Stages =============================================================
    function swap(stageNode) {
        clearChildren(card);
        card.appendChild(stageNode);
    }

    function showError(title, msg) {
        var stage = el('div', { class: 'dl-stage' },
            el('div', { class: 'error-icon' }, svgFromString(SVG_ERROR)),
            el('h2',  { class: 'download-title', text: title }),
            el('p',   { class: 'download-subtitle', text: msg }),
            el('a',   {
                href:  'index.php',
                class: 'btn btn-primary',
                style: 'display:inline-flex;text-decoration:none;flex:0',
                text:  'Retour à l\'accueil'
            })
        );
        swap(stage);
    }

    function showInfo(info, keyBytes) {
        var timeLeft  = formatTimeLeft(info.expires_at);
        var remaining = info.max_downloads > 0 ? (info.max_downloads - info.downloads) : null;

        var dlBtn = el('button', {
            type:  'button',
            class: 'btn btn-primary',
            style: 'width:100%;flex:0'
        }, svgFromString(SVG_DOWNLOAD_BTN), document.createTextNode('Télécharger et déchiffrer'));

        dlBtn.addEventListener('click', function () {
            downloadAndDecrypt(info, keyBytes).catch(function (err) {
                console.error(err);
                showError('Erreur', err && err.message ? err.message : 'Déchiffrement échoué');
            });
        });

        var meta = el('div', { class: 'download-meta' },
            el('div', { class: 'meta-item' },
                el('span', { class: 'meta-label', text: 'Taille' }),
                el('span', { class: 'meta-value', text: formatSize(info.size) })
            ),
            el('div', { class: 'meta-item' },
                el('span', { class: 'meta-label', text: 'Expire' }),
                el('span', { class: 'meta-value', text: timeLeft })
            ),
            el('div', { class: 'meta-item' },
                el('span', { class: 'meta-label', text: 'Restants' }),
                el('span', { class: 'meta-value', text: remaining === null ? '\u221E' : String(remaining) })
            )
        );

        var stage = el('div', { class: 'dl-stage' },
            el('div', { class: 'download-icon' }, svgFromString(SVG_LOCK)),
            el('h2',  { class: 'download-title', text: 'Transfert chiffré' }),
            el('p',   { class: 'download-subtitle', text: 'Prêt à être déchiffré dans votre navigateur' }),
            meta,
            dlBtn
        );
        swap(stage);
    }

    function showProgress(title, percent, detail) {
        var pct = Math.min(100, Math.max(0, percent));

        var fill = el('div', { class: 'progress-fill', style: 'width:' + pct + '%' });
        var bar  = el('div', { class: 'progress-bar' }, fill);

        var stage = el('div', { class: 'dl-stage' },
            el('div', { class: 'upload-spinner', style: 'margin-bottom:24px' }, svgFromString(SVG_SPINNER)),
            el('div', { class: 'progress-status', text: title }),
            bar,
            el('div', { class: 'progress-detail', text: detail || (Math.round(pct) + '%') })
        );
        swap(stage);
    }

    function showFiles(files) {
        var list = el('div', { class: 'file-list' });

        files.forEach(function (f, i) {
            var dlBtn = el('button', {
                type:   'button',
                class:  'btn btn-icon-only',
                title:  'Télécharger',
                dataset:{ fileIdx: String(i) }
            }, svgFromString(SVG_DOWNLOAD_SMALL));

            dlBtn.addEventListener('click', function () { downloadFile(files[i]); });

            var item = el('div', { class: 'file-item' },
                el('div', { class: 'file-item-icon' }, svgFromString(SVG_FILE)),
                el('div', { class: 'file-item-info' },
                    el('div', { class: 'file-item-name', text: f.name }),
                    el('div', { class: 'file-item-size', text: formatSize(f.size) })
                ),
                dlBtn
            );
            list.appendChild(item);
        });

        var children = [
            el('div', { class: 'success-icon' }, svgFromString(SVG_CHECK)),
            el('h2',  { class: 'download-title', text: 'Déchiffré' }),
            el('p',   {
                class: 'download-subtitle',
                text:  files.length + ' fichier' + (files.length > 1 ? 's' : '') +
                       ' disponible' + (files.length > 1 ? 's' : '')
            }),
            list
        ];

        if (files.length > 1) {
            var allBtn = el('button', {
                type:  'button',
                class: 'btn btn-primary',
                style: 'width:100%;flex:0;margin-top:8px',
                text:  'Tout télécharger (' + files.length + ')'
            });
            allBtn.addEventListener('click', function () {
                files.forEach(function (f, i) {
                    setTimeout(function () { downloadFile(f); }, i * 350);
                });
            });
            children.push(allBtn);
        }

        var stage = el.apply(null, ['div', { class: 'dl-stage' }].concat(children));
        swap(stage);

        if (files.length === 1) {
            setTimeout(function () { downloadFile(files[0]); }, 250);
        }
    }

    function downloadFile(fileObj) {
        var blob = fileObj.blob || new Blob([fileObj.data], { type: fileObj.type || 'application/octet-stream' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = fileObj.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    // === Streaming download + decrypt =======================================
    async function downloadAndDecrypt(info, keyBytes) {
        var cryptoKey = await crypto.subtle.importKey(
            'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
        );

        showProgress('Téléchargement', 0, '0 / ' + formatSize(info.size));

        var res = await fetch(cfg.apiDownload + '?id=' + encodeURIComponent(info.id));
        if (!res.ok) {
            if (res.status === 410) throw new Error('Ce transfert n\'est plus disponible');
            if (res.status === 404) throw new Error('Transfert introuvable');
            throw new Error('Erreur serveur (HTTP ' + res.status + ')');
        }
        if (!res.body || typeof res.body.getReader !== 'function') {
            throw new Error('Votre navigateur ne supporte pas la lecture en flux');
        }

        var reader = res.body.getReader();

        // --- Pull-through buffer: accumulates fetch chunks, serves consume(n) ---
        var queue      = [];    // array of Uint8Array (raw fetch chunks)
        var qBytes     = 0;     // total bytes across all queue entries
        var headOff    = 0;     // byte offset into queue[0] where reading starts
        var streamDone = false;
        var received   = 0;
        var totalSize  = info.size || 0;

        async function pullMore() {
            if (streamDone) return false;
            var r = await reader.read();
            if (r.done) { streamDone = true; return false; }
            queue.push(r.value);
            qBytes   += r.value.byteLength;
            received += r.value.byteLength;
            var pct = totalSize > 0 ? (received / totalSize) * 100 : 0;
            showProgress('Téléchargement', pct,
                formatSize(received) + ' / ' + formatSize(totalSize));
            return true;
        }

        async function ensure(n) {
            while (qBytes < n) {
                var more = await pullMore();
                if (!more) throw new Error('Flux tronqué');
            }
        }

        function consume(n) {
            if (qBytes < n) throw new Error('consume sous-approvisionné');

            // Fast path: first queue entry has all requested bytes
            var head = queue[0];
            if (head.byteLength - headOff >= n) {
                var out = head.subarray(headOff, headOff + n);
                headOff += n;
                qBytes  -= n;
                if (headOff === head.byteLength) { queue.shift(); headOff = 0; }
                return out;
            }

            // Slow path: copy across queue entries
            var out2 = new Uint8Array(n);
            var copied = 0;
            while (copied < n) {
                var h     = queue[0];
                var avail = h.byteLength - headOff;
                var take  = Math.min(avail, n - copied);
                out2.set(h.subarray(headOff, headOff + take), copied);
                copied  += take;
                headOff += take;
                qBytes  -= take;
                if (headOff === h.byteLength) { queue.shift(); headOff = 0; }
            }
            return out2;
        }

        async function readAndDecryptChunk(chunkIdx) {
            await ensure(IV_LEN + LEN_LEN);
            var iv       = consume(IV_LEN);
            var lenBytes = consume(LEN_LEN);
            var lenDv    = new DataView(lenBytes.buffer, lenBytes.byteOffset, LEN_LEN);
            var len      = lenDv.getUint32(0, true);

            if (len <= 0 || len > MAX_CHUNK_CT) {
                throw new Error('Chunk corrompu (taille ' + len + ')');
            }

            await ensure(len);
            var ct = consume(len);

            var aad = new Uint8Array(4);
            new DataView(aad.buffer).setUint32(0, chunkIdx, true);

            var plain;
            try {
                plain = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv: iv, additionalData: aad },
                    cryptoKey,
                    ct
                );
            } catch (e) {
                throw new Error('Clé invalide ou fichier corrompu');
            }
            return new Uint8Array(plain);
        }

        // --- Parse 16-byte header ---
        await ensure(HEADER_SIZE);
        var headerBuf = consume(HEADER_SIZE);
        var hdv       = new DataView(headerBuf.buffer, headerBuf.byteOffset, HEADER_SIZE);
        var magic     = hdv.getUint32(0, false);
        var version   = hdv.getUint8(4);

        if (magic !== STREAM_MAGIC || version !== STREAM_VERSION) {
            throw new Error('Format de fichier non supporté');
        }
        var plainChunkSize = hdv.getUint32(8, true);
        var numChunks      = hdv.getUint32(12, true);
        if (numChunks < 1 || plainChunkSize <= 0) {
            throw new Error('En-tête corrompu');
        }

        // --- Chunk 0 = manifest ---
        var manifestPlain = await readAndDecryptChunk(0);
        var manifest;
        try {
            manifest = JSON.parse(new TextDecoder().decode(manifestPlain));
        } catch (e) {
            throw new Error('Manifeste illisible');
        }
        if (!manifest || !Array.isArray(manifest.files)) {
            throw new Error('Manifeste invalide');
        }
        if (manifest.files.length > 10000) {
            throw new Error('Trop de fichiers dans le manifeste');
        }
        for (var mi = 0; mi < manifest.files.length; mi++) {
            var mf = manifest.files[mi];
            if (typeof mf.name !== 'string' || mf.name.length === 0 || mf.name.length > 1024) {
                throw new Error('Nom de fichier invalide dans le manifeste');
            }
            if (typeof mf.size !== 'number' || mf.size < 0 || !isFinite(mf.size)) {
                throw new Error('Taille de fichier invalide dans le manifeste');
            }
        }

        // --- Per-file staging: accumulate slices, flush to Blobs periodically ---
        var files = manifest.files.map(function (m) {
            return {
                name:         m.name,
                type:         m.type || 'application/octet-stream',
                size:         m.size,
                blobs:        [],   // flushed Blob segments (browser may disk-back them)
                pending:      [],   // Uint8Array slices waiting to be flushed
                pendingBytes: 0,
                filled:       0
            };
        });

        function feedFile(f, chunk, start, take) {
            // .slice() copies so the entire plaintext chunk buffer can be GC'd
            f.pending.push(chunk.slice(start, start + take));
            f.pendingBytes += take;
            f.filled       += take;
            if (f.pendingBytes >= BLOB_FLUSH_SIZE) {
                f.blobs.push(new Blob(f.pending, { type: f.type }));
                f.pending      = [];
                f.pendingBytes = 0;
            }
        }

        // --- Data chunks 1..numChunks-1 ---
        var fileIdx = 0;
        for (var ci = 1; ci < numChunks; ci++) {
            var plain = await readAndDecryptChunk(ci);

            var off = 0;
            while (off < plain.byteLength) {
                // Advance past completed files
                while (fileIdx < files.length && files[fileIdx].filled === files[fileIdx].size) {
                    fileIdx++;
                }
                if (fileIdx >= files.length) {
                    throw new Error('Trop de données par rapport au manifeste');
                }
                var f    = files[fileIdx];
                var need = f.size - f.filled;
                var take = Math.min(need, plain.byteLength - off);
                if (take > 0) {
                    feedFile(f, plain, off, take);
                    off += take;
                }
                if (f.filled === f.size) fileIdx++;
            }

            // Yield to UI occasionally so progress redraws
            if ((ci & 7) === 0) await new Promise(function (r) { setTimeout(r, 0); });
        }

        // --- Verify completeness ---
        for (var i = 0; i < files.length; i++) {
            if (files[i].filled !== files[i].size) {
                throw new Error('Données incomplètes pour ' + files[i].name);
            }
        }

        // --- Collapse pending slices into final Blobs ---
        var out = files.map(function (f) {
            if (f.pending.length > 0) {
                f.blobs.push(new Blob(f.pending, { type: f.type }));
                f.pending      = [];
                f.pendingBytes = 0;
            }
            return {
                name: f.name,
                type: f.type,
                size: f.size,
                blob: new Blob(f.blobs, { type: f.type })
            };
        });

        showFiles(out);
    }

    // === Boot ===============================================================
    async function main() {
        if (!window.crypto || !window.crypto.subtle) {
            showError('Navigateur non supporté',
                'L\'API Web Crypto est requise pour déchiffrer ce transfert');
            return;
        }
        if (!cfg.id) {
            showError('Lien invalide', 'Aucun identifiant de transfert dans l\'URL');
            return;
        }

        var frag = window.location.hash.substring(1);
        if (!frag) {
            showError('Clé manquante',
                'Le lien ne contient pas la clé de déchiffrement (#…)');
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
            var res = await fetch(cfg.apiInfo + '?id=' + encodeURIComponent(cfg.id));
            if (!res.ok) {
                var err = await res.json().catch(function () { return {}; });
                if (res.status === 404) {
                    showError('Transfert introuvable',
                        'Ce transfert n\'existe pas ou a été supprimé');
                } else if (res.status === 410) {
                    showError('Transfert expiré',
                        err.error || 'Ce lien n\'est plus valable');
                } else {
                    showError('Erreur',
                        err.error || 'Impossible de charger le transfert');
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
