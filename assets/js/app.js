/* NyxTransfer — upload page logic
 * Supports two modes: file transfer (streaming AES-256-GCM, 4 MB chunks)
 * and encrypted messages (single-shot AES-256-GCM).
 * DOM is built exclusively via createElement/textContent — no unsafe HTML injection.
 */
(function () {
    'use strict';

    var cfg = window.NYX_CONFIG;

    var els = {
        card:               document.getElementById('uploadCard'),
        stageInput:         document.getElementById('stageInput'),
        stageUploading:     document.getElementById('stageUploading'),
        stageSuccess:       document.getElementById('stageSuccess'),
        stageError:         document.getElementById('stageError'),
        dropzone:           document.getElementById('dropzone'),
        fileInput:          document.getElementById('fileInput'),
        fileList:           document.getElementById('fileList'),
        messageInput:       document.getElementById('messageInput'),
        messageText:        document.getElementById('messageText'),
        charCount:          document.getElementById('charCount'),
        maxAccessLabel:     document.getElementById('maxAccessLabel'),
        stageActions:       document.getElementById('stageActions'),
        uploadBtn:          document.getElementById('uploadBtn'),
        clearBtn:           document.getElementById('clearBtn'),
        expirationSelect:   document.getElementById('expirationSelect'),
        maxDownloadsSelect: document.getElementById('maxDownloadsSelect'),
        progressFill:       document.getElementById('progressFill'),
        progressDetail:     document.getElementById('progressDetail'),
        progressStatus:     document.getElementById('progressStatus'),
        shareLink:          document.getElementById('shareLink'),
        copyBtn:            document.getElementById('copyBtn'),
        shareInfo:          document.getElementById('shareInfo'),
        newTransferBtn:     document.getElementById('newTransferBtn'),
        errorMessage:       document.getElementById('errorMessage'),
        retryBtn:           document.getElementById('retryBtn')
    };

    var selectedFiles = [];
    var currentMode   = 'file';

    // === Streaming crypto constants =========================================
    var STREAM_MAGIC     = 0x4E595853; // 'NYXS'
    var STREAM_VERSION   = 2;
    var HEADER_SIZE      = 16;
    var PLAIN_CHUNK_SIZE = 4 * 1024 * 1024;
    var READ_SLICE       = 1 * 1024 * 1024;
    var IV_LEN           = 12;
    var LEN_LEN          = 4;
    var TAG_LEN          = 16;
    var CHUNK_OVERHEAD   = IV_LEN + LEN_LEN + TAG_LEN;

    // === Safe DOM helpers ===================================================
    function clearChildren(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
    }

    function svgFromString(str) {
        var doc = new DOMParser().parseFromString(str, 'image/svg+xml');
        return document.importNode(doc.documentElement, true);
    }

    var SVG_FILE_ICON =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
        '<polyline points="14 2 14 8 20 8"/>' +
        '</svg>';

    var SVG_CLOSE_ICON =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" ' +
        'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="18" y1="6" x2="6" y2="18"/>' +
        '<line x1="6" y1="6" x2="18" y2="18"/>' +
        '</svg>';

    // === Stage management ===================================================
    function setStage(name) {
        [els.stageInput, els.stageUploading, els.stageSuccess, els.stageError]
            .forEach(function (el) { el.hidden = true; });
        var map = {
            input:     els.stageInput,
            uploading: els.stageUploading,
            success:   els.stageSuccess,
            error:     els.stageError
        };
        map[name].hidden = false;
    }

    // === Mode switching =====================================================
    function switchMode(mode) {
        currentMode = mode;

        // Toggle tabs
        document.querySelectorAll('.mode-tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.mode === mode);
        });

        // Toggle all data-mode sections (hero, features, security)
        document.querySelectorAll('[data-mode]').forEach(function (el) {
            if (!el.classList.contains('mode-tab')) {
                el.hidden = el.dataset.mode !== mode;
            }
        });

        // Toggle card content
        if (mode === 'file') {
            els.dropzone.hidden     = false;
            els.messageInput.hidden = true;
            els.maxAccessLabel.textContent = 'Téléchargements max';
            renderFileList();
        } else {
            els.dropzone.hidden     = true;
            els.fileList.hidden     = true;
            els.messageInput.hidden = false;
            els.maxAccessLabel.textContent = 'Consultations max';
            els.stageActions.hidden = !els.messageText.value.trim();
        }
    }

    document.querySelectorAll('.mode-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            switchMode(tab.dataset.mode);
        });
    });

    // === Message text input =================================================
    if (els.messageText) {
        els.messageText.addEventListener('input', function () {
            var count = els.messageText.value.length;
            els.charCount.textContent = count.toLocaleString('fr-FR');
            if (currentMode === 'message') {
                els.stageActions.hidden = !els.messageText.value.trim();
            }
        });
    }

    // === File selection =====================================================
    function handleFiles(files) {
        if (currentMode !== 'file') return;
        var arr = Array.from(files).filter(function (f) { return f.size > 0; });
        if (arr.length === 0) return;

        var total = selectedFiles.reduce(function (s, f) { return s + f.size; }, 0);
        for (var i = 0; i < arr.length; i++) {
            total += arr[i].size;
            if (total > cfg.maxSize) {
                showError('Taille totale dépassée (max ' + formatSize(cfg.maxSize) + ')');
                return;
            }
            selectedFiles.push(arr[i]);
        }
        renderFileList();
    }

    function renderFileList() {
        clearChildren(els.fileList);
        if (selectedFiles.length === 0) {
            els.fileList.hidden = true;
            if (currentMode === 'file') els.stageActions.hidden = true;
            return;
        }
        els.fileList.hidden = false;
        els.stageActions.hidden = false;

        selectedFiles.forEach(function (file, idx) {
            var item = document.createElement('div');
            item.className = 'file-item';

            var icon = document.createElement('div');
            icon.className = 'file-item-icon';
            icon.appendChild(svgFromString(SVG_FILE_ICON));

            var info = document.createElement('div');
            info.className = 'file-item-info';
            var name = document.createElement('div');
            name.className = 'file-item-name';
            name.textContent = file.name;
            var size = document.createElement('div');
            size.className = 'file-item-size';
            size.textContent = formatSize(file.size);
            info.appendChild(name);
            info.appendChild(size);

            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'file-item-remove';
            removeBtn.setAttribute('aria-label', 'Retirer');
            removeBtn.appendChild(svgFromString(SVG_CLOSE_ICON));
            removeBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                selectedFiles.splice(idx, 1);
                renderFileList();
            });

            item.appendChild(icon);
            item.appendChild(info);
            item.appendChild(removeBtn);
            els.fileList.appendChild(item);
        });
    }

    // === Drag & drop ========================================================
    els.fileInput.addEventListener('change', function (e) {
        handleFiles(e.target.files);
        e.target.value = '';
    });

    var dragCounter = 0;
    document.addEventListener('dragenter', function (e) {
        e.preventDefault();
        if (currentMode !== 'file') return;
        dragCounter++;
        els.dropzone.classList.add('dragover');
    });
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('dragleave', function (e) {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            els.dropzone.classList.remove('dragover');
        }
    });
    document.addEventListener('drop', function (e) {
        e.preventDefault();
        dragCounter = 0;
        els.dropzone.classList.remove('dragover');
        if (currentMode === 'file' && e.dataTransfer && e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });

    els.clearBtn.addEventListener('click', function () {
        if (currentMode === 'file') {
            selectedFiles = [];
            renderFileList();
        } else {
            els.messageText.value = '';
            els.charCount.textContent = '0';
            els.stageActions.hidden = true;
        }
    });

    els.uploadBtn.addEventListener('click', function () {
        var p = currentMode === 'message' ? startMessageUpload() : startUpload();
        p.catch(function (err) {
            console.error(err);
            showError(err && err.message ? err.message : 'Erreur inconnue');
        });
    });

    els.newTransferBtn.addEventListener('click', function () {
        selectedFiles = [];
        renderFileList();
        if (els.messageText) {
            els.messageText.value = '';
            els.charCount.textContent = '0';
        }
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

    // === Message upload (single-shot AES-256-GCM) ===========================
    async function startMessageUpload() {
        var text = els.messageText.value.trim();
        if (!text) return;

        setStage('uploading');
        setProgress(10, 'Chiffrement...');

        var cryptoKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 }, true, ['encrypt']
        );
        var rawKey = await crypto.subtle.exportKey('raw', cryptoKey);
        var keyB64 = bytesToB64Url(new Uint8Array(rawKey));

        var iv = crypto.getRandomValues(new Uint8Array(12));
        var plaintext = new TextEncoder().encode(text);
        var ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv }, cryptoKey, plaintext
        );

        var blob = new Uint8Array(iv.byteLength + ct.byteLength);
        blob.set(iv, 0);
        blob.set(new Uint8Array(ct), iv.byteLength);

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
                max_views:  parseInt(els.maxDownloadsSelect.value, 10)
            })
        });
        if (!res.ok) {
            var err = await res.json().catch(function () { return {}; });
            throw new Error(err.error || 'Erreur lors de l\'envoi');
        }
        var data = await res.json();

        showMessageSuccess(data.id, keyB64);
    }

    function showMessageSuccess(id, keyB64) {
        var url = window.location.origin + cfg.baseUrl + 'm.php?id=' + encodeURIComponent(id) + '#' + keyB64;
        els.shareLink.value = url;

        var expiration = parseInt(els.expirationSelect.value, 10);
        var maxViews   = parseInt(els.maxDownloadsSelect.value, 10);
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

    // === File upload (streaming) ============================================
    async function startUpload() {
        if (selectedFiles.length === 0) return;

        setStage('uploading');
        setProgress(0, 'Préparation...');

        var cryptoKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 }, true, ['encrypt']
        );
        var rawKey = await crypto.subtle.exportKey('raw', cryptoKey);
        var keyB64 = bytesToB64Url(new Uint8Array(rawKey));

        var manifest = {
            v:       2,
            files:   selectedFiles.map(function (f) {
                return { name: f.name, size: f.size, type: f.type || 'application/octet-stream' };
            }),
            created: Date.now()
        };
        var manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

        var totalData = 0;
        for (var i = 0; i < selectedFiles.length; i++) totalData += selectedFiles[i].size;

        var numDataChunks = totalData > 0 ? Math.ceil(totalData / PLAIN_CHUNK_SIZE) : 0;
        var numChunks     = 1 + numDataChunks;

        var totalOutput =
            HEADER_SIZE +
            (CHUNK_OVERHEAD + manifestBytes.byteLength) +
            (numDataChunks * CHUNK_OVERHEAD + totalData);

        setProgress(1, 'Initialisation...');
        var initRes = await fetch(cfg.apiUpload + '?action=init', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
                size:          totalOutput,
                expiration:    parseInt(els.expirationSelect.value, 10),
                max_downloads: parseInt(els.maxDownloadsSelect.value, 10)
            })
        });
        if (!initRes.ok) {
            var err = await initRes.json().catch(function () { return {}; });
            throw new Error(err.error || 'Échec d\'initialisation');
        }
        var initData = await initRes.json();

        try {
            await streamEncryptAndUpload(cryptoKey, manifestBytes, numChunks, totalOutput, initData);
        } catch (err) {
            try {
                await fetch(cfg.apiUpload + '?action=abort', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ id: initData.id, token: initData.token })
                });
            } catch (_) {}
            throw err;
        }

        setProgress(100, 'Finalisation...');
        var finRes = await fetch(cfg.apiUpload + '?action=finalize', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ id: initData.id, token: initData.token })
        });
        if (!finRes.ok) {
            var err2 = await finRes.json().catch(function () { return {}; });
            throw new Error(err2.error || 'Échec de finalisation');
        }

        showSuccess(initData.id, keyB64);
    }

    async function streamEncryptAndUpload(cryptoKey, manifestBytes, numChunks, totalOutput, initData) {
        var networkChunkSize = initData.chunk_size || (5 * 1024 * 1024);

        var outQueue   = [];
        var queueBytes = 0;
        var sentBytes  = 0;
        var netIdx     = 0;

        function enqueue(u8) {
            if (u8.byteLength === 0) return;
            outQueue.push(u8);
            queueBytes += u8.byteLength;
        }

        async function flushNetwork(force) {
            while ((force && queueBytes > 0) || queueBytes >= networkChunkSize) {
                var take  = Math.min(queueBytes, networkChunkSize);
                var piece = new Uint8Array(take);
                var copied = 0;
                while (copied < take) {
                    var head = outQueue[0];
                    var need = take - copied;
                    if (head.byteLength <= need) {
                        piece.set(head, copied);
                        copied += head.byteLength;
                        outQueue.shift();
                    } else {
                        piece.set(head.subarray(0, need), copied);
                        outQueue[0] = head.subarray(need);
                        copied += need;
                    }
                }
                queueBytes -= take;

                await uploadChunk(initData.id, initData.token, netIdx, piece, function (bytes) {
                    var frac = (sentBytes + bytes) / totalOutput;
                    setProgress(frac * 100, 'Envoi ' + Math.round(frac * 100) + '%');
                });
                sentBytes += take;
                netIdx++;
            }
        }

        var header = new Uint8Array(HEADER_SIZE);
        var hdv    = new DataView(header.buffer);
        hdv.setUint32(0, STREAM_MAGIC, false);
        hdv.setUint8(4, STREAM_VERSION);
        hdv.setUint8(5, 0);
        hdv.setUint16(6, 0, true);
        hdv.setUint32(8, PLAIN_CHUNK_SIZE, true);
        hdv.setUint32(12, numChunks, true);
        enqueue(header);

        setProgress(2, 'Chiffrement en cours...');
        await encryptAndEnqueueChunk(cryptoKey, 0, manifestBytes, enqueue);
        await flushNetwork(false);

        var plainBuf = new Uint8Array(PLAIN_CHUNK_SIZE);
        var bufUsed  = 0;
        var chunkIdx = 1;

        for (var fi = 0; fi < selectedFiles.length; fi++) {
            var file = selectedFiles[fi];
            var off = 0;
            while (off < file.size) {
                var end = Math.min(off + READ_SLICE, file.size);
                var ab  = await file.slice(off, end).arrayBuffer();
                var src = new Uint8Array(ab);
                var srcOff = 0;

                while (srcOff < src.byteLength) {
                    var space = PLAIN_CHUNK_SIZE - bufUsed;
                    var take  = Math.min(space, src.byteLength - srcOff);
                    plainBuf.set(src.subarray(srcOff, srcOff + take), bufUsed);
                    bufUsed += take;
                    srcOff  += take;

                    if (bufUsed === PLAIN_CHUNK_SIZE) {
                        await encryptAndEnqueueChunk(
                            cryptoKey, chunkIdx, plainBuf.subarray(0, PLAIN_CHUNK_SIZE), enqueue
                        );
                        chunkIdx++;
                        bufUsed = 0;
                        await flushNetwork(false);
                    }
                }
                off = end;
            }
        }

        if (bufUsed > 0) {
            await encryptAndEnqueueChunk(
                cryptoKey, chunkIdx, plainBuf.subarray(0, bufUsed), enqueue
            );
            chunkIdx++;
        }

        await flushNetwork(true);
    }

    async function encryptAndEnqueueChunk(cryptoKey, chunkIdx, plaintext, enqueue) {
        var iv  = crypto.getRandomValues(new Uint8Array(IV_LEN));
        var aad = new Uint8Array(4);
        new DataView(aad.buffer).setUint32(0, chunkIdx, true);

        var ct = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv, additionalData: aad },
            cryptoKey,
            plaintext
        );

        var lenBuf = new Uint8Array(LEN_LEN);
        new DataView(lenBuf.buffer).setUint32(0, ct.byteLength, true);

        enqueue(iv);
        enqueue(lenBuf);
        enqueue(new Uint8Array(ct));
    }

    function uploadChunk(id, token, index, chunk, onProgress) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            var url = cfg.apiUpload +
                '?action=chunk' +
                '&id='    + encodeURIComponent(id) +
                '&token=' + encodeURIComponent(token) +
                '&index=' + index;
            xhr.open('POST', url);
            xhr.setRequestHeader('Content-Type', 'application/octet-stream');
            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable && onProgress) onProgress(e.loaded);
            };
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    var msg = 'HTTP ' + xhr.status;
                    try {
                        var j = JSON.parse(xhr.responseText);
                        if (j.error) msg = j.error;
                    } catch (e) {}
                    reject(new Error(msg));
                }
            };
            xhr.onerror = function () { reject(new Error('Erreur réseau pendant l\'envoi')); };
            xhr.send(chunk);
        });
    }

    function bytesToB64Url(bytes) {
        var s = '';
        for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // === UI helpers =========================================================
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
        var url = window.location.origin + cfg.baseUrl + 'd.php?id=' + encodeURIComponent(id) + '#' + keyB64;
        els.shareLink.value = url;

        var expiration   = parseInt(els.expirationSelect.value, 10);
        var maxDownloads = parseInt(els.maxDownloadsSelect.value, 10);
        var expTxt       = formatDuration(expiration);
        var dlTxt        = maxDownloads === 0
            ? 'téléchargements illimités'
            : maxDownloads + ' téléchargement' + (maxDownloads > 1 ? 's' : '');
        els.shareInfo.textContent = 'Expire dans ' + expTxt + ' · ' + dlTxt;

        setStage('success');
        setTimeout(function () {
            els.shareLink.focus();
            els.shareLink.select();
        }, 200);
    }

    function formatSize(bytes) {
        if (bytes < 1024)               return bytes + ' o';
        if (bytes < 1024 * 1024)        return (bytes / 1024).toFixed(1) + ' Ko';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
        return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' Go';
    }

    function formatDuration(seconds) {
        if (seconds < 3600)  return Math.round(seconds / 60) + ' min';
        if (seconds < 86400) return Math.round(seconds / 3600) + ' h';
        return Math.round(seconds / 86400) + ' j';
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

    // === Boot ===============================================================
    if (!window.crypto || !window.crypto.subtle) {
        showError('Votre navigateur ne supporte pas l\'API Web Crypto. Utilisez Chrome, Firefox, Safari ou Edge récents.');
        if (els.uploadBtn) els.uploadBtn.disabled = true;
    }
})();
