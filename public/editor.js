/**
 * SMART VLE TOOL - Integrated Image Editor Studio Module
 * Fully compatible with Document Studio & ID Print Studio
 */

/**
 * Separate Database for Image & PDF Editor
 * Database B: Monu_ImagePDFEditor_DB
 */
window.ImagePDFEditorDB = {
    dbName: 'Monu_ImagePDFEditor_DB',
    version: 1,
    db: null,
    async init() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, this.version);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('editorProjects')) {
                    db.createObjectStore('editorProjects', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('editorImages')) {
                    db.createObjectStore('editorImages', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('editorPDFs')) {
                    db.createObjectStore('editorPDFs', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('editorSettings')) {
                    db.createObjectStore('editorSettings', { keyPath: 'key' });
                }
            };
            req.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async saveEditorData(key, data) {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('editorProjects', 'readwrite');
                const store = tx.objectStore('editorProjects');
                store.put({ id: key, timestamp: Date.now(), data });
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn('ImagePDFEditorDB Save Warning:', err);
        }
    },
    async getEditorData(key) {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('editorProjects', 'readonly');
                const store = tx.objectStore('editorProjects');
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result ? req.result.data : null);
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn('ImagePDFEditorDB Load Warning:', err);
            return null;
        }
    }
};

window.addEventListener('DOMContentLoaded', () => {
    window.ImagePDFEditorDB.init().catch(err => console.warn('Editor DB init error:', err));
});

let IMG = null, IMG_FILE = null, RESULT = null, FNAME = 'image', TOOL = 'compress', COMPRESSED_RESULT = null;
const DPI = 96;
let HISTORY = [], HIST_IDX = -1, liveTimer = null;
let brightnessApplied = false;

// ═══ REAL-TIME IMAGE INFO BAR ═══
function updateImageInfoBar(imgElement, dataUrl, filename, originalFile) {
    const dimEl = document.getElementById('editorInfoDim') || document.getElementById('barImgDim');
    const sizeEl = document.getElementById('editorInfoSize') || document.getElementById('barImgSize');
    const aspectEl = document.getElementById('barImgAspect');
    const formatEl = document.getElementById('barImgFormat');

    if (!imgElement || (!imgElement.naturalWidth && !imgElement.width)) {
        if (dimEl) dimEl.textContent = 'Dimensions: No Image Loaded';
        if (sizeEl) sizeEl.textContent = 'Size: —';
        if (aspectEl) aspectEl.textContent = '—';
        if (formatEl) formatEl.textContent = '—';
        return;
    }

    const w = imgElement.naturalWidth || imgElement.width || 0;
    const h = imgElement.naturalHeight || imgElement.height || 0;

    let format = 'PNG';
    if (originalFile && originalFile.type) {
        format = originalFile.type.replace('image/', '').toUpperCase();
    } else if (dataUrl) {
        if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) format = 'JPEG';
        else if (dataUrl.startsWith('data:image/webp')) format = 'WEBP';
        else if (dataUrl.startsWith('data:image/png')) format = 'PNG';
        else if (dataUrl.startsWith('data:image/svg')) format = 'SVG';
        else if (dataUrl.startsWith('data:image/bmp')) format = 'BMP';
    }

    let sizeStr = '—';
    if (originalFile && typeof originalFile.size === 'number' && originalFile.size > 0) {
        const bytes = originalFile.size;
        sizeStr = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : (bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`);
    } else if (dataUrl && dataUrl.startsWith('data:')) {
        const base64Len = (dataUrl.split(',')[1] || '').length;
        const bytes = Math.round(base64Len * 3 / 4);
        sizeStr = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : (bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`);
    }

    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const divisor = (w && h) ? gcd(w, h) : 1;
    const aspectFraction = `${Math.round(w / divisor)}:${Math.round(h / divisor)}`;
    const aspectDecimal = h > 0 ? (w / h).toFixed(2) : '1.00';
    const aspectRatioDisplay = `${w > 0 && h > 0 ? aspectFraction + ' (' + aspectDecimal + ')' : '—'}`;

    const mp = ((w * h) / 1000000).toFixed(2);

    if (dimEl) {
        if (dimEl.id === 'editorInfoDim') {
            dimEl.textContent = `Dimensions: ${w} × ${h} px`;
        } else {
            dimEl.textContent = `${w} × ${h} px`;
        }
    }
    if (sizeEl) {
        if (sizeEl.id === 'editorInfoSize') {
            sizeEl.textContent = `Size: ${sizeStr}`;
        } else {
            sizeEl.textContent = sizeStr;
        }
    }
    if (aspectEl) aspectEl.textContent = aspectRatioDisplay;
    if (formatEl) formatEl.textContent = `${format} • ${mp} MP`;
}

// ═══ BRIDGE: TRANSFER BETWEEN DOCUMENT STUDIO AND EDITOR ═══
function openCurrentInEditor() {
    if (typeof activeIndex === 'undefined' || activeIndex === -1 || !imageArray[activeIndex]) {
        if (typeof switchMode === 'function') switchMode('EDITOR');
        showEditorStatus('ℹ️ Switched to Image Editor. Upload an image or use any tool below.', 'info');
        return;
    }

    let imgObj = imageArray[activeIndex];
    let sourceDataUrl = null;

    // Use cropped/processed canvas if available, otherwise rendered rotated original
    if (typeof tempCurrentCroppedCanvas !== 'undefined' && tempCurrentCroppedCanvas) {
        sourceDataUrl = tempCurrentCroppedCanvas.toDataURL('image/png');
    } else if (typeof renderRotatedOriginalToCanvas === 'function') {
        let baseCanvas = renderRotatedOriginalToCanvas(imgObj);
        sourceDataUrl = baseCanvas.toDataURL('image/png');
        if (baseCanvas) {
            baseCanvas.width = 1;
            baseCanvas.height = 1;
        }
    } else if (imgObj.element && imgObj.element.src) {
        sourceDataUrl = imgObj.element.src;
    }

    if (sourceDataUrl) {
        loadEditorFromDataUrl(sourceDataUrl, imgObj.name || 'document_page');
        if (typeof switchMode === 'function') switchMode('EDITOR');
    }
}

function loadEditorFromDataUrl(dataUrl, name) {
    FNAME = (name || 'image').replace(/\.[^/.]+$/, '');
    IMG_FILE = null;
    const img = new Image();
    img.onload = () => {
        IMG = img;
        HISTORY = [];
        HIST_IDX = -1;
        const origImgEl = document.getElementById('origImg');
        const livePreviewImg = document.getElementById('livePreviewImg');
        const resInfo = document.getElementById('resInfo');
        const rW = document.getElementById('rW');
        const rH = document.getElementById('rH');
        const uploadZone = document.getElementById('editorUploadZone');
        const singlePreview = document.getElementById('editorSinglePreview');
        const changeImgBtn = document.getElementById('changeImgBtn');
        const resetImgBtn = document.getElementById('resetImgBtn');
        const deleteImgBtn = document.getElementById('deleteImgBtn');

        if (origImgEl) origImgEl.src = dataUrl;
        if (livePreviewImg) {
            livePreviewImg.src = dataUrl;
            livePreviewImg.style.filter = 'none';
            livePreviewImg.style.transform = '';
        }
        if (resInfo) {
            const kb = ((dataUrl.split(',')[1].length * 3 / 4) / 1024).toFixed(1);
            resInfo.textContent = `${img.width}×${img.height}px | ~${kb}KB`;
        }
        if (rW) rW.placeholder = img.width;
        if (rH) rH.placeholder = img.height;
        if (uploadZone) uploadZone.style.display = 'none';
        if (singlePreview) singlePreview.style.display = 'flex';
        if (changeImgBtn) changeImgBtn.style.display = '';
        if (resetImgBtn) resetImgBtn.style.display = '';
        if (deleteImgBtn) deleteImgBtn.style.display = '';

        updateImageInfoBar(img, dataUrl, FNAME, null);
        updateEditorFilenameUI(true);
        pushHistory(dataUrl, 'Imported from Document Studio');
        showEditorStatus('✅ Image imported from Document Studio! Choose any tool below.', 'ok');
        
        // Select crop or current tool
        switchTool(TOOL || 'compress', null);
    };
    img.src = dataUrl;
}

function syncEditorToScanner() {
    let currentUrl = RESULT || (IMG ? IMG.src : null);
    if (!currentUrl) {
        showEditorStatus('⚠️ No edited image available to send to Document Studio.', 'err');
        return;
    }

    const img = new Image();
    img.onload = () => {
        if (typeof imageArray !== 'undefined') {
            let targetIndex = -1;
            if (typeof activeIndex !== 'undefined' && activeIndex !== -1 && imageArray[activeIndex]) {
                // Update active page
                let activeObj = imageArray[activeIndex];
                activeObj.element = img;
                activeObj.rotation = 0; // rotation is already baked in
                activeObj.corners = null;
                activeObj.cornersDisplayDim = null;
                activeObj.processedCanvas = null;
                targetIndex = activeIndex;
            } else {
                // Append as new page
                imageArray.push({
                    id: Date.now() + Math.random(),
                    name: `${FNAME || 'edited'}_processed.png`,
                    element: img,
                    rotation: 0,
                    corners: null,
                    cornersDisplayDim: null,
                    processedCanvas: null,
                    contrast: 1.0,
                    brightness: 0,
                    saturation: 1.0,
                    sharpness: 0,
                    shadowRemoval: false,
                    filterMode: 'GRAYSCALE'
                });
                targetIndex = imageArray.length - 1;
                activeIndex = targetIndex;
            }

            if (typeof docStudioState !== 'undefined') {
                docStudioState.activeIndex = targetIndex;
                docStudioState.corners = null;
            }
            if (typeof corners !== 'undefined') {
                corners = null;
            }

            if (typeof switchMode === 'function') switchMode('DOC');
            if (typeof rebuildGalleryStrip === 'function') rebuildGalleryStrip();
            if (typeof updateButtonStates === 'function') updateButtonStates();
            if (typeof setActiveImage === 'function') setActiveImage(targetIndex);

            // Double enforce standard edge corners on newly imported document after canvas render
            setTimeout(() => {
                let canvasSrc = document.getElementById('canvas-src');
                if (canvasSrc) {
                    let displayW = parseFloat(canvasSrc.style.width) || canvasSrc.width;
                    let displayH = parseFloat(canvasSrc.style.height) || canvasSrc.height;
                    if (displayW > 10 && displayH > 10) {
                        if (typeof initPointersStandard === 'function') {
                            initPointersStandard(displayW, displayH);
                        }
                        if (typeof updatePointerDOM === 'function') {
                            updatePointerDOM();
                        }
                        if (typeof scheduleLiveTransform === 'function') {
                            scheduleLiveTransform(30);
                        }
                    }
                }
            }, 80);

            showEditorStatus('✅ Image sent to Document Studio!', 'ok');
        }
    };
    img.src = currentUrl;
}

// ═══ UNDO / REDO ═══
function pushHistory(url, label) {
    HISTORY = HISTORY.slice(0, HIST_IDX + 1);
    HISTORY.push({ url, label });
    if (HISTORY.length > 10) HISTORY.shift();
    HIST_IDX = HISTORY.length - 1;
    updateURBtns();
}

function updateURBtns() {
    const uBtn = document.getElementById('undoBtn');
    const rBtn = document.getElementById('redoBtn');
    const uCnt = document.getElementById('undoCount');
    const rCnt = document.getElementById('redoCount');
    if (uBtn) uBtn.disabled = HIST_IDX <= 0;
    if (rBtn) rBtn.disabled = HIST_IDX >= HISTORY.length - 1;
    if (uCnt) uCnt.textContent = Math.max(0, HIST_IDX);
    if (rCnt) rCnt.textContent = Math.max(0, HISTORY.length - 1 - HIST_IDX);
}

function applyHistory(idx) {
    const s = HISTORY[idx];
    if (!s) return;
    resetCompressBaseImage();
    RESULT = s.url;
    const img = new Image();
    img.onload = () => {
        IMG = img;
        const livePreviewImg = document.getElementById('livePreviewImg');
        const origImg = document.getElementById('origImg');
        const resInfo = document.getElementById('resInfo');
        if (livePreviewImg) {
            livePreviewImg.src = s.url;
            livePreviewImg.style.filter = 'none';
            livePreviewImg.style.transform = '';
        }
        if (origImg) origImg.src = s.url;
        if (resInfo) {
            const kb = ((s.url.split(',')[1].length * 3 / 4) / 1024).toFixed(1);
            resInfo.textContent = `${img.width}×${img.height}px | ~${kb}KB`;
        }
        updateImageInfoBar(img, s.url, FNAME, IMG_FILE);
    };
    img.src = s.url;
    showEditorStatus(`${HIST_IDX < idx + 1 ? '↩' : '↪'}: ${s.label}`, 'info');
}

function doUndo() {
    if (HIST_IDX <= 0) return;
    HIST_IDX--;
    applyHistory(HIST_IDX);
    updateURBtns();
}

function doRedo() {
    if (HIST_IDX >= HISTORY.length - 1) return;
    HIST_IDX++;
    applyHistory(HIST_IDX);
    updateURBtns();
}

// ═══ RESET IMAGE EDITS TO ORIGINAL ═══
function resetEditorImage() {
    if (!IMG || !HISTORY.length) {
        showEditorStatus('⚠️ No image loaded to reset.', 'err');
        return;
    }
    resetCompressBaseImage();
    HIST_IDX = 0;
    const initial = HISTORY[0];
    RESULT = initial.url;
    const img = new Image();
    img.onload = () => {
        IMG = img;
        const livePreviewImg = document.getElementById('livePreviewImg');
        const origImg = document.getElementById('origImg');
        const resInfo = document.getElementById('resInfo');
        if (livePreviewImg) {
            livePreviewImg.src = initial.url;
            livePreviewImg.style.filter = 'none';
            livePreviewImg.style.transform = '';
        }
        if (origImg) origImg.src = initial.url;
        if (resInfo) {
            resInfo.textContent = 'Adjust controls to render preview';
        }
        
        if (TOOL === 'crop') initCropDisplay();
        if (TOOL === 'rotate') {
            const rotS = document.getElementById('rotSlider');
            const rotV = document.getElementById('rotV');
            if (rotS) rotS.value = 0;
            if (rotV) rotV.textContent = '0';
        }
        if (TOOL === 'flip') liveFlipDir = 'none';
        if (TOOL === 'brightness') resetBrightness();
        
        updateImageInfoBar(img, initial.url, FNAME, IMG_FILE);
        updateURBtns();
        showEditorStatus('↺ Reset image edits back to original source.', 'ok');
    };
    img.src = initial.url;
}

// ═══ DELETE IMAGE AND CLEAR WORKSPACE ═══
function deleteEditorImage() {
    if (!IMG) return;
    
    resetCompressBaseImage();
    IMG = null;
    IMG_FILE = null;
    RESULT = null;
    FNAME = 'image';
    HISTORY = [];
    HIST_IDX = -1;
    
    const livePreviewImg = document.getElementById('livePreviewImg');
    const origImg = document.getElementById('origImg');
    const cropImgEl = document.getElementById('cropImgEl');
    const uploadZone = document.getElementById('editorUploadZone');
    const singlePreview = document.getElementById('editorSinglePreview');
    const cropCanvasPane = document.getElementById('editorCropCanvasPane');
    const changeImgBtn = document.getElementById('changeImgBtn');
    const resetImgBtn = document.getElementById('resetImgBtn');
    const deleteImgBtn = document.getElementById('deleteImgBtn');
    const fileInput = document.getElementById('editorFileInput');
    
    if (fileInput) fileInput.value = '';
    if (livePreviewImg) {
        livePreviewImg.src = '';
        livePreviewImg.style.filter = 'none';
        livePreviewImg.style.transform = '';
    }
    if (origImg) origImg.src = '';
    if (cropImgEl) cropImgEl.src = '';
    
    const hiddenCanvas = document.getElementById('canvas-hidden');
    if (hiddenCanvas) {
        const ctx = hiddenCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, hiddenCanvas.width, hiddenCanvas.height);
        hiddenCanvas.width = 0;
        hiddenCanvas.height = 0;
    }
    
    if (singlePreview) singlePreview.style.display = 'none';
    if (cropCanvasPane) cropCanvasPane.style.display = 'none';
    if (uploadZone) uploadZone.style.display = 'flex';
    
    if (changeImgBtn) changeImgBtn.style.display = 'none';
    if (resetImgBtn) resetImgBtn.style.display = 'none';
    if (deleteImgBtn) deleteImgBtn.style.display = 'none';
    
    updateURBtns();
    updateImageInfoBar(null, null, '', null);
    showEditorStatus('🗑️ Active image deleted and workspace cleared.', 'info');
}

window.addEventListener('keydown', e => {
    if (typeof currentMode !== 'undefined' && currentMode !== 'EDITOR') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        doRedo();
    }
});

// ═══ TOOL METADATA ═══
const EDITOR_TOOLS_META = {
    compress: { title: 'Compress / Increase Image', desc: 'Reduce or enlarge image file size with exact KB targeting & quality control.' },
    resize: { title: 'Resize Image Dimensions', desc: 'Set custom width and height in pixels while maintaining high visual quality.' },
    crop: { title: 'Crop, Flip & Rotate Canvas', desc: 'Crop with precise units and presets, flip horizontal/vertical, or rotate 90° CCW/CW.' },
    convert: { title: 'Format Converter', desc: 'Convert seamlessly between JPG, PNG, WEBP, BMP, TIFF, and AVIF formats.' },
    brightness: { title: 'Brightness, Contrast & Saturation', desc: 'Tune exposure, contrast, saturation, and hue shift with instant live preview.' },
    watermark: { title: 'Custom Text Watermark', desc: 'Stamp text copyright, brand marks, or notices at 9 anchor points with opacity control.' },
    img2pdf: { title: 'Batch Images to PDF Compiler', desc: 'Compile multiple images into one multi-page PDF with reordering, sizing, and target limits.' },
    pdfcompress: { title: 'PDF Compress & Optimizer', desc: 'Unified multi-file/multi-page PDF optimization with multi-pass DPI rendering.' }
};

// ═══ SWITCH TOOL ═══
function switchTool(id, btn) {
    TOOL = id;
    const allTabs = document.querySelectorAll('.editor-tool-tab');
    allTabs.forEach(b => b.classList.remove('active'));
    if (btn) {
        btn.classList.add('active');
    } else {
        const found = document.querySelector(`.editor-tool-tab[data-tool="${id}"]`);
        if (found) found.classList.add('active');
    }

    const t = EDITOR_TOOLS_META[id] || {};
    const titleEl = document.getElementById('editorToolTitle');
    const descEl = document.getElementById('editorToolDesc');
    if (titleEl) titleEl.textContent = t.title || id;
    if (descEl) descEl.textContent = t.desc || '';

    // Hide all tool containers in right pane
    document.querySelectorAll('[id^="c-"]').forEach(el => el.style.display = 'none');
    const p = document.getElementById('c-' + id);
    if (p) p.style.display = 'block';

    const previewPane = document.getElementById('editorPreviewPane');
    const toolPane = document.getElementById('editorToolPane');
    const singlePreview = document.getElementById('editorSinglePreview');
    const cropCanvasPane = document.getElementById('editorCropCanvasPane');
    const i2pLeftStage = document.getElementById('i2pLeftStage');
    const pdfOptLeftStage = document.getElementById('pdfOptLeftStage');
    const uploadZone = document.getElementById('editorUploadZone');
    const livePreviewImg = document.getElementById('livePreviewImg');
    const changeImgBtn = document.getElementById('changeImgBtn');
    const resetImgBtn = document.getElementById('resetImgBtn');
    const deleteImgBtn = document.getElementById('deleteImgBtn');
    const bottomActionStrip = document.querySelector('.editor-actions-strip');

    if (previewPane) previewPane.style.display = 'flex';
    if (toolPane) toolPane.style.display = 'flex';

    const standaloneTools = ['img2pdf', 'pdfcompress'];
    const isStandalone = standaloneTools.includes(id);
    const isCrop = id === 'crop';

    if (changeImgBtn) {
        changeImgBtn.style.display = (IMG && !isStandalone) ? '' : 'none';
    }
    if (resetImgBtn) {
        resetImgBtn.style.display = (IMG && !isStandalone) ? '' : 'none';
    }
    if (deleteImgBtn) {
        deleteImgBtn.style.display = (IMG && !isStandalone) ? '' : 'none';
    }
    if (bottomActionStrip) {
        bottomActionStrip.style.display = isStandalone ? 'none' : 'flex';
    }

    if (id === 'img2pdf') {
        if (i2pLeftStage) i2pLeftStage.style.display = 'flex';
        if (pdfOptLeftStage) pdfOptLeftStage.style.display = 'none';
        if (singlePreview) singlePreview.style.display = 'none';
        if (cropCanvasPane) cropCanvasPane.style.display = 'none';
        if (uploadZone) uploadZone.style.display = 'none';
        renderImg2PdfList();
    } else if (id === 'pdfcompress') {
        if (pdfOptLeftStage) pdfOptLeftStage.style.display = 'flex';
        if (i2pLeftStage) i2pLeftStage.style.display = 'none';
        if (singlePreview) singlePreview.style.display = 'none';
        if (cropCanvasPane) cropCanvasPane.style.display = 'none';
        if (uploadZone) uploadZone.style.display = 'none';
        renderPdfOptPages();
        updatePdfEstimate();
    } else {
        if (i2pLeftStage) i2pLeftStage.style.display = 'none';
        if (pdfOptLeftStage) pdfOptLeftStage.style.display = 'none';

        if (isCrop && IMG) {
            if (singlePreview) singlePreview.style.display = 'none';
            if (uploadZone) uploadZone.style.display = 'none';
            if (cropCanvasPane) cropCanvasPane.style.display = 'flex';
        } else {
            if (cropCanvasPane) cropCanvasPane.style.display = 'none';
            if (!IMG) {
                if (uploadZone) uploadZone.style.display = 'flex';
                if (singlePreview) singlePreview.style.display = 'none';
            } else {
                if (uploadZone) uploadZone.style.display = 'none';
                if (singlePreview) singlePreview.style.display = 'flex';
            }
        }
    }

    // Reset temporary CSS transforms on live preview
    if (!isStandalone && livePreviewImg) {
        livePreviewImg.style.filter = 'none';
        livePreviewImg.style.transform = '';
    }

    if (IMG && !isStandalone) {
        updateImageInfoBar(IMG, RESULT || IMG.src, FNAME, IMG_FILE);
        updateEditorFilenameUI(false);
        if (id === 'compress') {
            if (sizeMode === 'increase') liveIncrease();
            else liveCompress();
        }
        if (id === 'crop') initCropDisplay();
        if (id === 'brightness') resetBrightness();
    }
}

// ═══ LOAD IMAGE (EDITOR) ═══
function loadEditorImg(input) {
    const file = input.files[0];
    if (!file) return;
    if (window.MonuSessionManager && window.MonuSessionManager.setProcessingLocation) {
        window.MonuSessionManager.setProcessingLocation('BROWSER');
    }
    IMG_FILE = file;
    FNAME = file.name.replace(/\.[^/.]+$/, '');
    showEditorProgress(true);
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            resetCompressBaseImage();
            IMG = img;
            HISTORY = [];
            HIST_IDX = -1;
            const src = e.target.result;
            const origImg = document.getElementById('origImg');
            const livePreviewImg = document.getElementById('livePreviewImg');
            const resInfo = document.getElementById('resInfo');
            const rW = document.getElementById('rW');
            const rH = document.getElementById('rH');
            const changeImgBtn = document.getElementById('changeImgBtn');
            const resetImgBtn = document.getElementById('resetImgBtn');
            const deleteImgBtn = document.getElementById('deleteImgBtn');
            const uploadZone = document.getElementById('editorUploadZone');
            const singlePreview = document.getElementById('editorSinglePreview');

            if (origImg) origImg.src = src;
            if (livePreviewImg) {
                livePreviewImg.src = src;
                livePreviewImg.style.filter = 'none';
                livePreviewImg.style.transform = '';
            }
            if (uploadZone) uploadZone.style.display = 'none';
            if (singlePreview) singlePreview.style.display = 'flex';
            if (resInfo) resInfo.textContent = 'Adjust controls to render preview';
            finishEditorProgress();
            showEditorStatus('✅ Image loaded! Select any editing tool.', 'ok');
            pushHistory(src, 'Original');
            updateImageInfoBar(img, src, FNAME, file);
            updateEditorFilenameUI(true);
            if (rW) rW.placeholder = img.width;
            if (rH) rH.placeholder = img.height;
            if (changeImgBtn) changeImgBtn.style.display = '';
            if (resetImgBtn) resetImgBtn.style.display = '';
            if (deleteImgBtn) deleteImgBtn.style.display = '';

            if (window.MonuSessionManager && window.MonuSessionManager.setProcessingLocation) {
                window.MonuSessionManager.setProcessingLocation('COMPLETED_BROWSER');
            }

            switchTool(TOOL, null);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ═══ STATUS & PROGRESS ═══
function showEditorStatus(msg, type) {
    const sb = document.getElementById('editorStatusBar');
    if (!sb) return;
    sb.textContent = msg;
    sb.className = 'status-bar ' + type;
}

function showEditorProgress(v) {
    const pw = document.getElementById('editorProgressWrap');
    const pb = document.getElementById('editorProgressBar');
    if (!pw || !pb) return;
    pw.classList.toggle('show', v);
    if (v) {
        let w = 0;
        const iv = setInterval(() => {
            w = Math.min(w + 3, 88);
            pb.style.width = w + '%';
            if (w >= 88) clearInterval(iv);
        }, 25);
    }
}

function finishEditorProgress() {
    const pw = document.getElementById('editorProgressWrap');
    const pb = document.getElementById('editorProgressBar');
    if (!pw || !pb) return;
    pb.style.width = '100%';
    setTimeout(() => {
        pw.classList.remove('show');
        pb.style.width = '0%';
    }, 400);
}

function getCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

function setEditorResult(url, label, skipReTrigger = false) {
    clearTimeout(liveTimer);
    resetCompressBaseImage();
    RESULT = url;
    const ni = new Image();
    ni.onload = () => {
        IMG = ni;

        const livePreviewImg = document.getElementById('livePreviewImg');
        const origImg = document.getElementById('origImg');
        const cropImgEl = document.getElementById('cropImgEl');
        const resInfo = document.getElementById('resInfo');
        const rW = document.getElementById('rW');
        const rH = document.getElementById('rH');

        if (livePreviewImg) {
            livePreviewImg.src = url;
            livePreviewImg.style.filter = 'none';
            livePreviewImg.style.transform = '';
        }
        if (origImg) origImg.src = url;
        if (cropImgEl) cropImgEl.src = url;
        if (rW) rW.placeholder = ni.width;
        if (rH) rH.placeholder = ni.height;

        let kb = '—';
        if (url && url.startsWith('data:')) {
            kb = (((url.split(',')[1] || '').length * 3 / 4) / 1024).toFixed(1);
        }
        if (resInfo) resInfo.textContent = `${ni.width}×${ni.height}px` + (kb !== '—' ? ` | ~${kb}KB` : '');
        updateImageInfoBar(ni, url, FNAME, null);

        if (!skipReTrigger) {
            if (TOOL === 'crop') {
                initCropDisplay();
            } else if (TOOL === 'compress') {
                liveCompress();
            } else if (TOOL === 'resize') {
                liveResize();
            }
        }
    };
    ni.src = url;
    IMG = ni;

    let estKb = '';
    if (url && url.startsWith('data:')) {
        estKb = ` (~${(((url.split(',')[1] || '').length * 3 / 4) / 1024).toFixed(1)}KB)`;
    }
    showEditorStatus(`✅ ${label}${estKb}. Click ⬇️ Download or 📥 Send to Document Studio.`, 'ok');
    pushHistory(url, label);
    updateEditorFilenameUI();
    finishEditorProgress();
}

let CUSTOM_EDITOR_FNAME = '';

function onEditorFilenameInput(val) {
    CUSTOM_EDITOR_FNAME = (val || '').trim();
    updateEditorFilenameUI(false);
}

function resetEditorFilename() {
    CUSTOM_EDITOR_FNAME = '';
    const fnInput = document.getElementById('editorDownloadFilename');
    if (fnInput) fnInput.value = '';
    updateEditorFilenameUI(true);
}

function getEditorDownloadFilename(outputExt) {
    const defaultName = `${FNAME || 'image'}_${TOOL || 'edited'}`;
    let name = CUSTOM_EDITOR_FNAME || defaultName;
    // Sanitize invalid filename characters
    name = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (!name) name = defaultName;

    const extRegex = new RegExp(`\\.${outputExt}$`, 'i');
    if (!extRegex.test(name)) {
        // Strip other existing file extensions if mismatched
        name = name.replace(/\.[a-zA-Z0-9]+$/, '');
        name = `${name}.${outputExt}`;
    }
    return name;
}

function updateEditorFilenameUI(forceReset = false) {
    const fnInput = document.getElementById('editorDownloadFilename');
    const extEl = document.getElementById('editorFilenameExt');
    
    const targetUrl = RESULT || (IMG ? IMG.src : '');
    const ext = targetUrl.startsWith('data:image/png') ? 'png' : targetUrl.startsWith('data:image/webp') ? 'webp' : 'jpg';
    
    if (extEl) extEl.textContent = `.${ext}`;
    
    if (fnInput) {
        const defaultBase = `${FNAME || 'image'}_${TOOL || 'edited'}`;
        fnInput.placeholder = defaultBase;
        if (forceReset) {
            fnInput.value = '';
            CUSTOM_EDITOR_FNAME = '';
        }
    }
}

function doEditorDownload() {
    if (!RESULT && !IMG && !COMPRESSED_RESULT) {
        showEditorStatus('⚠️ Apply a tool or load an image first.', 'err');
        return;
    }
    const isCompressTool = TOOL === 'compress';
    let targetBlob = (isCompressTool && COMPRESSED_RESULT && COMPRESSED_RESULT.blob) ? COMPRESSED_RESULT.blob : null;
    let targetUrl = (targetBlob && COMPRESSED_RESULT.url) ? COMPRESSED_RESULT.url : (RESULT || (IMG ? IMG.src : ''));

    let ext = 'jpg';
    if (targetBlob && targetBlob.type) {
        ext = targetBlob.type.replace('image/', '');
        if (ext === 'jpeg') ext = 'jpg';
    } else if (targetUrl.startsWith('data:image/png') || (targetUrl.startsWith('blob:') && COMPRESSED_RESULT?.format === 'image/png')) {
        ext = 'png';
    } else if (targetUrl.startsWith('data:image/webp') || (targetUrl.startsWith('blob:') && COMPRESSED_RESULT?.format === 'image/webp')) {
        ext = 'webp';
    }

    const defaultBase = `${FNAME || 'image'}_${TOOL || 'edited'}`;
    let estKb = '';
    if (targetBlob) {
        const bytes = targetBlob.size;
        estKb = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
    } else if (targetUrl.startsWith('data:')) {
        const bytes = Math.round((targetUrl.split(',')[1] || '').length * 3 / 4);
        estKb = bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
    }

    let dimStr = '';
    if (isCompressTool && COMPRESSED_RESULT) {
        dimStr = `${COMPRESSED_RESULT.width} × ${COMPRESSED_RESULT.height} px`;
    } else if (IMG) {
        dimStr = `${IMG.naturalWidth || IMG.width} × ${IMG.naturalHeight || IMG.height} px`;
    }

    if (typeof triggerDownloadWithFilenameModal === 'function') {
        triggerDownloadWithFilenameModal(targetUrl, defaultBase, ext, dimStr, estKb, targetBlob);
    } else {
        const finalFilename = `${defaultBase}.${ext}`;
        const downloadUrl = targetBlob ? URL.createObjectURL(targetBlob) : targetUrl;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = finalFilename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (targetBlob) {
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
        }
    }
}

function cssLivePreview(filterStr) {
    const livePreviewImg = document.getElementById('livePreviewImg');
    if (!livePreviewImg || !IMG) return;
    livePreviewImg.style.filter = filterStr;
    livePreviewImg.style.transform = '';
}

function canvasLivePreview(fn, delay = 80) {
    if (!IMG) return;
    const captured = IMG;
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
        if (IMG !== captured && RESULT) return;
        try {
            const res = fn();
            const url = (res && typeof res.then === 'function') ? await res : res;
            const livePreviewImg = document.getElementById('livePreviewImg');
            if (url && typeof url === 'string' && (url.startsWith('data:') || url.startsWith('blob:')) && livePreviewImg) {
                livePreviewImg.src = url;
                livePreviewImg.style.filter = 'none';
                livePreviewImg.style.transform = '';
            }
        } catch (e) {
            console.warn('Live preview error:', e);
        }
    }, delay);
}

function resetToolPreview() {
    if (!IMG) return;
    clearTimeout(liveTimer);
    const livePreviewImg = document.getElementById('livePreviewImg');
    if (livePreviewImg) {
        livePreviewImg.style.filter = 'none';
        livePreviewImg.style.transform = '';
        livePreviewImg.src = IMG.src;
    }
    showEditorStatus('↺ Preview reset to current saved image.', 'info');
}

// ═══ 1. COMPRESS / INCREASE ═══
let sizeMode = 'compress';
let compressBaseImg = null; // Pristine source locked for re-compression
let latestCompressReqId = 0;
let latestIncreaseReqId = 0;

function getCompressSourceImage() {
    if (compressBaseImg && compressBaseImg.width > 0) {
        return compressBaseImg;
    }
    if (IMG) {
        compressBaseImg = IMG;
        return compressBaseImg;
    }
    return null;
}

function resetCompressBaseImage() {
    compressBaseImg = null;
    COMPRESSED_RESULT = null;
}

function setSizeMode(m, btn) {
    sizeMode = m;
    latestCompressReqId++;
    latestIncreaseReqId++;
    clearTimeout(liveTimer);
    document.querySelectorAll('#c-compress .sm-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('compressMode').style.display = m === 'compress' ? '' : 'none';
    document.getElementById('increaseMode').style.display = m === 'increase' ? '' : 'none';
    if (m === 'compress') liveCompress(80); else liveIncrease(80);
}

// Resolution & Quality Detector
function analyzeCompressSource(srcImg, options = {}) {
    if (window.SmartOptimizationEngine) {
        return window.SmartOptimizationEngine.analyzeImageSource(srcImg, options);
    }
    const w = srcImg.naturalWidth || srcImg.width || 0;
    const h = srcImg.naturalHeight || srcImg.height || 0;
    const mp = (w * h) / 1000000;
    let category = 'medium';
    if (mp >= 2.5 || w >= 2000 || h >= 2000) category = 'high';
    else if (mp < 0.85 || (w <= 900 && h <= 900)) category = 'low';
    let minQualityFloor = category === 'low' ? 0.82 : (category === 'medium' ? 0.70 : 0.58);
    let adaptiveQuality = category === 'low' ? 0.92 : (category === 'medium' ? 0.86 : 0.82);
    return { width: w, height: h, megapixels: mp, category, minQualityFloor, adaptiveQuality };
}

function onCompressPresetChange() {
    liveCompress();
}
window.onCompressPresetChange = onCompressPresetChange;

async function processImageCompress(srcSnap, format, sliderQuality, targetKB, reqId = 0, dpi = 300) {
    if (window.SmartOptimizationEngine && window.SmartOptimizationEngine.optimizeImage) {
        const result = await window.SmartOptimizationEngine.optimizeImage(srcSnap, {
            format,
            targetKB,
            quality: sliderQuality,
            dpi,
            shouldAbort: reqId ? () => reqId !== latestCompressReqId : undefined,
            originalBytes: (IMG_FILE && IMG_FILE.size) ? IMG_FILE.size : 0
        });

        if (!result || result.aborted || (reqId && reqId !== latestCompressReqId)) {
            return { aborted: true };
        }

        COMPRESSED_RESULT = result;

        return {
            rawResult: result,
            url: result.dataUrl || result.url,
            blob: result.blob,
            actualKB: parseFloat(result.actualKB.toFixed(1)),
            actualBytes: result.actualBytes,
            quality: result.quality !== undefined ? result.quality : sliderQuality,
            width: result.width,
            height: result.height,
            originalWidth: result.originalWidth,
            originalHeight: result.originalHeight,
            scaleUsed: result.scaleUsed !== undefined ? result.scaleUsed : 1.0,
            resolutionReduced: !!result.resolutionReduced,
            targetStatus: result.status,
            targetKB: result.targetKB,
            statusMessage: result.statusMessage,
            targetReached: result.targetReached,
            nearTarget: result.nearTarget
        };
    }

    // High-fidelity fallback
    const origW = srcSnap.naturalWidth || srcSnap.width || 1;
    const origH = srcSnap.naturalHeight || srcSnap.height || 1;
    const c = getCanvas(origW, origH);
    const ctx = c.getContext('2d');
    if (format !== 'image/png') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, origW, origH);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcSnap, 0, 0);
    const url = c.toDataURL(format, sliderQuality);
    const b64 = url.split(',')[1] || '';
    const actualBytes = Math.round(b64.length * 3 / 4);
    return {
        url,
        actualKB: parseFloat((actualBytes / 1024).toFixed(1)),
        actualBytes,
        quality: sliderQuality,
        width: origW,
        height: origH,
        originalWidth: origW,
        originalHeight: origH,
        scaleUsed: 1.0,
        resolutionReduced: false,
        targetStatus: targetKB > 0 ? (actualBytes <= targetKB * 1024 ? 'reached' : 'near') : 'none',
        targetKB,
        targetReached: targetKB > 0 ? actualBytes <= targetKB * 1024 : true,
        nearTarget: targetKB > 0 ? actualBytes > targetKB * 1024 : false
    };
}

function updateCompressStatsCard(srcSnap, resultUrl, resObj) {
    const card = document.getElementById('compressStatsCard');
    if (!card || !srcSnap || !resultUrl) return;

    card.style.display = 'block';

    const origW = resObj?.originalWidth || srcSnap.naturalWidth || srcSnap.width;
    const origH = resObj?.originalHeight || srcSnap.naturalHeight || srcSnap.height;
    const currentW = resObj?.width || origW;
    const currentH = resObj?.height || origH;
    
    let origBytes = resObj?.originalBytes || 0;
    if (!origBytes) {
        if (IMG_FILE && IMG_FILE.size) {
            origBytes = IMG_FILE.size;
        } else if (srcSnap.src && srcSnap.src.startsWith('data:')) {
            origBytes = Math.round((srcSnap.src.split(',')[1] || '').length * 3 / 4);
        } else {
            origBytes = Math.round(origW * origH * 3 * 0.4);
        }
    }

    const newBytes = resObj?.actualBytes || Math.round((resultUrl.split(',')[1] || '').length * 3 / 4);
    const origKB = origBytes / 1024;
    const newKB = newBytes / 1024;
    const pct = origBytes > 0 ? (((newBytes - origBytes) / origBytes) * 100) : 0;

    const badgeEl = document.getElementById('compResBadge');
    const origStats = document.getElementById('compOrigStats');
    const newStats = document.getElementById('compNewStats');
    const dimStats = document.getElementById('compDimStats');
    const savingsStats = document.getElementById('compSavingsStats');
    const targetLabel = document.getElementById('compTargetLabel');
    const targetStatus = document.getElementById('compTargetStatus');

    if (badgeEl) {
        badgeEl.textContent = 'Standard Service';
    }

    if (origStats) origStats.textContent = origKB >= 1024 ? `${(origKB / 1024).toFixed(2)} MB` : `${origKB.toFixed(1)} KB`;
    if (newStats) newStats.textContent = newKB >= 1024 ? `${(newKB / 1024).toFixed(2)} MB` : `${newKB.toFixed(1)} KB`;
    
    if (dimStats) {
        if (resObj && resObj.resolutionReduced) {
            dimStats.innerHTML = `<span style="color:#d97706; font-weight:700;">Scaled: ${currentW} × ${currentH} px (${Math.round((resObj.scaleUsed || 1) * 100)}%)</span>`;
        } else {
            dimStats.textContent = `${origW} × ${origH} px (100% Original)`;
        }
    }

    if (savingsStats) {
        if (pct < 0) {
            savingsStats.textContent = `${Math.abs(pct).toFixed(1)}% smaller`;
            savingsStats.style.color = '#10b981';
        } else {
            savingsStats.textContent = `${Math.abs(pct).toFixed(1)}% size`;
            savingsStats.style.color = 'var(--text-color)';
        }
    }

    if (targetLabel && targetStatus) {
        if (resObj && resObj.targetKB > 0) {
            targetLabel.textContent = `${resObj.targetKB} KB`;
            if (resObj.targetStatus === 'reached' || resObj.targetReached) {
                targetStatus.textContent = `🎯 TARGET REACHED (${resObj.actualKB} KB)`;
                targetStatus.style.background = '#d1fae5';
                targetStatus.style.color = '#065f46';
            } else {
                targetStatus.textContent = `TARGET NOT REACHED (${resObj.actualKB} KB)`;
                targetStatus.style.background = '#fee2e2';
                targetStatus.style.color = '#991b1b';
            }
        } else {
            targetLabel.textContent = `None`;
            targetStatus.textContent = `Standard Quality`;
            targetStatus.style.background = 'rgba(31,209,249,0.12)';
            targetStatus.style.color = 'var(--text-dark)';
        }
    }
}

function liveCompress(delayMs = 120) {
    const snap = getCompressSourceImage();
    if (!snap) return;

    const reqId = ++latestCompressReqId;
    const wait = (typeof delayMs === 'number' && delayMs >= 0) ? delayMs : 120;

    canvasLivePreview(async () => {
        if (reqId !== latestCompressReqId || sizeMode !== 'compress') return null;

        const fmt = document.getElementById('compFmt').value;
        const rawTarget = (document.getElementById('targetKB').value || '').trim();
        const targetKB = rawTarget !== '' ? (parseFloat(rawTarget) || 0) : 0;
        const sliderQual = parseInt(document.getElementById('qualSlider').value, 10) / 100;
        const compDpi = parseInt(document.getElementById('compDpi')?.value, 10) || 300;

        const res = await processImageCompress(snap, fmt, sliderQual, targetKB, reqId, compDpi);
        if (!res || res.aborted || reqId !== latestCompressReqId || sizeMode !== 'compress') {
            return null;
        }
        const url = res.url;

        updateCompressStatsCard(snap, url, res);

        const resInfo = document.getElementById('resInfo');
        if (resInfo) {
            const estKB = res.actualKB || (url.startsWith('data:') ? ((url.split(',')[1].length * 3 / 4) / 1024).toFixed(1) : '—');
            let statusNote = '';
            if (res.targetKB > 0) {
                if (res.targetStatus === 'reached' || res.targetReached) statusNote = ' [🎯 TARGET REACHED]';
                else statusNote = ' [TARGET NOT REACHED]';
            }
            const qDisp = Math.round((res.quality || sliderQual) * 100);
            resInfo.textContent = `Preview: ~${estKB}KB (${res.width}×${res.height}px, Quality: ${qDisp})${statusNote}`;
        }
        return url;
    }, wait);
}

function liveIncrease(delayMs = 120) {
    const snap = getCompressSourceImage();
    if (!snap) return;

    const reqId = ++latestIncreaseReqId;
    const wait = (typeof delayMs === 'number' && delayMs >= 0) ? delayMs : 120;

    canvasLivePreview(async () => {
        if (reqId !== latestIncreaseReqId || sizeMode !== 'increase') return null;

        const fmt = document.getElementById('incFmt').value;
        const q = parseInt(document.getElementById('incQualSlider').value, 10) / 100;
        const rawTarget = (document.getElementById('targetIncKB')?.value || '').trim();
        const targetKB = rawTarget !== '' ? (parseFloat(rawTarget) || 0) : 0;
        const compDpi = parseInt(document.getElementById('compDpi')?.value, 10) || 300;

        if (window.SmartOptimizationEngine && window.SmartOptimizationEngine.increaseImage) {
            const res = await window.SmartOptimizationEngine.increaseImage(snap, {
                format: fmt,
                targetKB,
                quality: q,
                dpi: compDpi,
                shouldAbort: () => reqId !== latestIncreaseReqId
            });
            if (!res || res.aborted || reqId !== latestIncreaseReqId || sizeMode !== 'increase') {
                return null;
            }
            COMPRESSED_RESULT = res;
            const resInfo = document.getElementById('resInfo');
            if (resInfo) {
                const statusTag = (targetKB > 0 && res.targetReached) ? ' [🎯 TARGET REACHED]' : '';
                resInfo.textContent = `Preview: ~${res.actualKB}KB (${res.width}×${res.height}px)${statusTag}`;
            }
            return res.dataUrl || res.url;
        }

        const c = getCanvas(snap.width, snap.height);
        const ctx = c.getContext('2d');
        if (fmt !== 'image/png') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, snap.width, snap.height);
        }
        ctx.drawImage(snap, 0, 0);
        const url = c.toDataURL(fmt, q);
        const resInfo = document.getElementById('resInfo');
        if (resInfo) resInfo.textContent = `Preview: ~${((url.split(',')[1].length * 3 / 4) / 1024).toFixed(1)}KB`;
        return url;
    }, wait);
}

async function doCompress() {
    const snap = getCompressSourceImage();
    if (!snap) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }

    clearTimeout(liveTimer);
    const reqId = ++latestCompressReqId;
    showEditorProgress(true);
    const fmt = document.getElementById('compFmt').value;
    const rawTarget = (document.getElementById('targetKB').value || '').trim();
    const targetKB = rawTarget !== '' ? (parseFloat(rawTarget) || 0) : 0;
    const sliderQual = parseInt(document.getElementById('qualSlider').value, 10) / 100;
    const compDpi = parseInt(document.getElementById('compDpi').value, 10) || 300;

    const dpiValEl = document.getElementById('compDpiVal');
    if (dpiValEl) dpiValEl.textContent = `${compDpi} DPI`;

    const res = await processImageCompress(snap, fmt, sliderQual, targetKB, reqId, compDpi);
    if (!res || res.aborted || reqId !== latestCompressReqId) {
        finishEditorProgress();
        return;
    }

    const finalKB = res.actualKB || (res.url.startsWith('data:') ? ((res.url.split(',')[1].length * 3 / 4) / 1024).toFixed(1) : '—');

    updateCompressStatsCard(snap, res.url, res);

    const qDisp = Math.round((res.quality || sliderQual) * 100);
    let statusMsg = `Compressed to ~${finalKB}KB (${res.width}×${res.height}px, Quality: ${qDisp})`;
    if (res.targetKB > 0) {
        if (res.targetStatus === 'reached' || res.targetReached) {
            statusMsg = `🎯 Target Reached! Compressed to ~${finalKB}KB (${res.width}×${res.height}px, Quality: ${qDisp})`;
        } else {
            statusMsg = `Target Not Reached: ~${finalKB}KB (${res.width}×${res.height}px, Quality: ${qDisp})`;
        }
    }

    setEditorResult(res.url, statusMsg, true);
    // Preserve pristine source image & exact Blob result for subsequent adjustments & download
    compressBaseImg = snap;
    COMPRESSED_RESULT = res.rawResult || res;
}

async function doIncrease() {
    const snap = getCompressSourceImage();
    if (!snap) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }

    clearTimeout(liveTimer);
    const reqId = ++latestIncreaseReqId;
    showEditorProgress(true);
    const fmt = document.getElementById('incFmt').value;
    const q = parseInt(document.getElementById('incQualSlider').value, 10) / 100;
    const rawTarget = (document.getElementById('targetIncKB').value || '').trim();
    const targetKB = rawTarget !== '' ? (parseFloat(rawTarget) || 0) : 0;
    const compDpi = parseInt(document.getElementById('compDpi')?.value, 10) || 300;

    if (window.SmartOptimizationEngine && window.SmartOptimizationEngine.increaseImage) {
        try {
            const res = await window.SmartOptimizationEngine.increaseImage(snap, {
                format: fmt,
                targetKB,
                quality: q,
                dpi: compDpi,
                shouldAbort: () => reqId !== latestIncreaseReqId
            });
            if (!res || res.aborted || reqId !== latestIncreaseReqId) {
                finishEditorProgress();
                return;
            }
            const outUrl = res.dataUrl || res.url;
            setEditorResult(outUrl, res.statusMessage, true);
            compressBaseImg = snap;
            COMPRESSED_RESULT = res;
            return;
        } catch (err) {
            console.warn('Increase image engine error:', err);
        }
    }

    const c = getCanvas(snap.width, snap.height);
    const ctx = c.getContext('2d');
    if (fmt !== 'image/png') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, snap.width, snap.height);
    }
    ctx.drawImage(snap, 0, 0);
    const url = c.toDataURL(fmt, q);
    setEditorResult(url, `Quality set to ${Math.round(q * 100)}%`, true);
    compressBaseImg = snap;
}

// ═══ 2. RESIZE (WITH UNIT CONVERSION) ═══
let currentResizeUnit = 'px';

function getResizeUnitDpi() {
    const compDpiInput = document.getElementById('compDpi');
    const compDpiVal = compDpiInput ? parseInt(compDpiInput.value, 10) : 0;
    return compDpiVal > 0 ? compDpiVal : 300;
}

function convertResizeVal(val, fromUnit, toUnit) {
    if (val === undefined || val === null || isNaN(val)) return '';
    const dpi = getResizeUnitDpi();
    let px = val;
    if (fromUnit === 'in') px = val * dpi;
    else if (fromUnit === 'cm') px = (val / 2.54) * dpi;
    else if (fromUnit === 'mm') px = (val / 25.4) * dpi;

    if (toUnit === 'px') return Math.round(px);
    if (toUnit === 'in') return +(px / dpi).toFixed(3);
    if (toUnit === 'cm') return +(px / dpi * 2.54).toFixed(3);
    if (toUnit === 'mm') return +(px / dpi * 25.4).toFixed(2);
    return Math.round(px);
}

function onResizeUnitChange(newUnit) {
    const rW = document.getElementById('rW');
    const rH = document.getElementById('rH');
    const lblW = document.getElementById('lblRW');
    const lblH = document.getElementById('lblRH');

    const unitLabels = { px: 'Pixels (px)', in: 'Inches (in)', cm: 'Centimeters (cm)', mm: 'Millimeters (mm)' };
    const labelText = unitLabels[newUnit] || 'Pixels';

    if (lblW) lblW.textContent = `Width (${labelText})`;
    if (lblH) lblH.textContent = `Height (${labelText})`;

    if (rW && rW.value !== '') {
        const numW = parseFloat(rW.value);
        if (!isNaN(numW)) rW.value = convertResizeVal(numW, currentResizeUnit, newUnit);
    }
    if (rH && rH.value !== '') {
        const numH = parseFloat(rH.value);
        if (!isNaN(numH)) rH.value = convertResizeVal(numH, currentResizeUnit, newUnit);
    }
    currentResizeUnit = newUnit;
    liveResize();
}

function arUpdate(ch) {
    if (!IMG || !document.getElementById('keepAR').checked) return;
    const ar = IMG.width / IMG.height;
    const rW = document.getElementById('rW');
    const rH = document.getElementById('rH');
    if (ch === 'w') {
        const w = parseFloat(rW.value);
        if (!isNaN(w) && w > 0) {
            const valH = w / ar;
            rH.value = currentResizeUnit === 'px' ? Math.round(valH) : +valH.toFixed(3);
        }
    } else {
        const h = parseFloat(rH.value);
        if (!isNaN(h) && h > 0) {
            const valW = h * ar;
            rW.value = currentResizeUnit === 'px' ? Math.round(valW) : +valW.toFixed(3);
        }
    }
}

function liveResize() {
    if (!IMG) return;
    const rW = document.getElementById('rW');
    const rH = document.getElementById('rH');
    const valW = parseFloat(rW.value);
    const valH = parseFloat(rH.value);

    let pxW = !isNaN(valW) && valW > 0 ? convertResizeVal(valW, currentResizeUnit, 'px') : IMG.width;
    let pxH = !isNaN(valH) && valH > 0 ? convertResizeVal(valH, currentResizeUnit, 'px') : IMG.height;
    pxW = Math.max(1, Math.round(pxW));
    pxH = Math.max(1, Math.round(pxH));

    const resInfo = document.getElementById('resInfo');
    if (resInfo) {
        if (currentResizeUnit === 'px') {
            resInfo.textContent = `Resize Target: ${pxW}×${pxH}px`;
        } else {
            resInfo.textContent = `Resize Target: ${valW || 0}×${valH || 0}${currentResizeUnit} (${pxW}×${pxH}px)`;
        }
    }
}

function doResize() {
    if (!IMG) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }
    showEditorProgress(true);
    const rW = document.getElementById('rW');
    const rH = document.getElementById('rH');
    const valW = parseFloat(rW.value);
    const valH = parseFloat(rH.value);

    let pxW = !isNaN(valW) && valW > 0 ? convertResizeVal(valW, currentResizeUnit, 'px') : IMG.width;
    let pxH = !isNaN(valH) && valH > 0 ? convertResizeVal(valH, currentResizeUnit, 'px') : IMG.height;
    pxW = Math.max(1, Math.round(pxW));
    pxH = Math.max(1, Math.round(pxH));

    const c = getCanvas(pxW, pxH);
    c.getContext('2d').drawImage(IMG, 0, 0, pxW, pxH);
    const desc = currentResizeUnit === 'px' ? `${pxW}×${pxH}px` : `${valW}×${valH}${currentResizeUnit} (${pxW}×${pxH}px)`;
    setEditorResult(c.toDataURL('image/jpeg', 0.97), `Resized to ${desc}`);
}

// ═══ 3. CROP (PHOTOSHOP STYLE) ═══
let cropUnit = 'px', cropAR = 0, crop = { x: 0, y: 0, w: 0, h: 0 };
let cropDragging = false, cropDragMode = null, cropDragStart = { x: 0, y: 0 }, cropStartCoords = { x: 0, y: 0, w: 0, h: 0 };
let cropInputRatio = 0;

function toPx(v) { return cropUnit === 'cm' ? v / 2.54 * DPI : cropUnit === 'mm' ? v / 25.4 * DPI : v; }
function fromPx(v) { return cropUnit === 'cm' ? +(v / DPI * 2.54).toFixed(3) : cropUnit === 'mm' ? +(v / DPI * 25.4).toFixed(2) : Math.round(v); }

function onCropWHInput() {
    const cropW = document.getElementById('cropW');
    const cropH = document.getElementById('cropH');
    const w = parseFloat(cropW.value), h = parseFloat(cropH.value);
    if (w > 0 && h > 0) {
        cropInputRatio = w / h;
        cropAR = cropInputRatio;
    } else {
        cropInputRatio = 0;
    }
    if (IMG && (w > 0 || h > 0)) {
        const newW = w ? Math.min(toPx(w), IMG.width) : crop.w || IMG.width / 2;
        const newH = h ? Math.min(toPx(h), IMG.height) : crop.h || IMG.height / 2;
        const cx = crop.w > 0 ? crop.x + crop.w / 2 : IMG.width / 2;
        const cy = crop.h > 0 ? crop.y + crop.h / 2 : IMG.height / 2;
        crop.w = newW;
        crop.h = newH;
        crop.x = clamp(cx - newW / 2, 0, IMG.width - newW);
        crop.y = clamp(cy - newH / 2, 0, IMG.height - newH);
        renderCropRect();
        updateCropSelInfo();
    }
}

function swapCropWH() {
    const cropW = document.getElementById('cropW');
    const cropH = document.getElementById('cropH');
    const w = cropW.value, h = cropH.value;
    cropW.value = h;
    cropH.value = w;
    onCropWHInput();
}

function clearCropWH() {
    const cropW = document.getElementById('cropW');
    const cropH = document.getElementById('cropH');
    cropW.value = '';
    cropH.value = '';
    cropInputRatio = 0;
    cropAR = 0;
    document.querySelectorAll('#aspectPresets .ap-btn').forEach(b => b.classList.remove('active'));
    const first = document.querySelector('#aspectPresets .ap-btn');
    if (first) first.classList.add('active');
}

function setCropUnitFromSelect(u) {
    cropUnit = u;
    renderCropRect();
    updateCropSelInfo();
}

function setAspectPreset(w, h, btn) {
    document.querySelectorAll('#aspectPresets .ap-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const cropW = document.getElementById('cropW');
    const cropH = document.getElementById('cropH');
    if (w === 0 && h === 0) {
        cropAR = 0;
        cropInputRatio = 0;
        if (cropW) cropW.value = '';
        if (cropH) cropH.value = '';
    } else {
        cropAR = w / h;
        cropInputRatio = w / h;
        if (crop.w > 0) {
            crop.h = crop.w / cropAR;
            renderCropRect();
            updateCropSelInfo();
        }
    }
}

function initCropDisplay() {
    if (!IMG) return;
    const el = document.getElementById('cropImgEl');
    const container = document.getElementById('cropContainer');
    const stage = document.getElementById('editorCropCanvasPane');
    if (!el || !container) return;

    // Use available stage dimensions with generous margin
    const stageW = (stage && stage.clientWidth > 100 ? stage.clientWidth : 750) - 32;
    const stageH = (stage && stage.clientHeight > 100 ? stage.clientHeight : 500) - 32;

    const imgAR = IMG.width / IMG.height;
    const stageAR = stageW / stageH;
    let iw, ih;
    if (imgAR > stageAR) {
        iw = Math.min(IMG.width, Math.max(280, stageW));
        ih = Math.round(iw / imgAR);
    } else {
        ih = Math.min(IMG.height, Math.max(280, stageH));
        iw = Math.round(ih * imgAR);
    }

    // Ensure it does not overflow container bounds
    if (ih > stageH) {
        ih = stageH;
        iw = Math.round(ih * imgAR);
    }
    if (iw > stageW) {
        iw = stageW;
        ih = Math.round(iw / imgAR);
    }

    el.style.width = iw + 'px';
    el.style.height = ih + 'px';
    container.style.width = iw + 'px';
    container.style.height = ih + 'px';
    el.style.maxWidth = 'none';
    el.style.maxHeight = 'none';
    el.src = IMG.src;
    crop = { x: 0, y: 0, w: 0, h: 0 };

    const cropRect = document.getElementById('cropRect');
    if (cropRect) cropRect.style.display = 'none';
    updateCropSelInfo();
    bindCropEvents();
}

function bindCropEvents() {
    const el = document.getElementById('cropImgEl');
    if (!el) return;
    const wrap = el.parentElement;
    if (!wrap) return;

    wrap.onmousedown = startCropDrag;
    wrap.ontouchstart = e => {
        const t = e.touches[0];
        startCropDrag({ clientX: t.clientX, clientY: t.clientY, target: e.target, shiftKey: false });
        e.preventDefault();
    };
    document.onmousemove = moveCropDrag;
    document.ontouchmove = e => {
        if (!cropDragging) return;
        const t = e.touches[0];
        moveCropDrag({ clientX: t.clientX, clientY: t.clientY, shiftKey: false });
        e.preventDefault();
    };
    document.onmouseup = document.ontouchend = () => { cropDragging = false; };
}

function imgCoords(cx, cy) {
    const el = document.getElementById('cropImgEl');
    if (!el || !IMG) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
        x: clamp((cx - r.left) / r.width * IMG.width, 0, IMG.width),
        y: clamp((cy - r.top) / r.height * IMG.height, 0, IMG.height)
    };
}

function startCropDrag(e) {
    if (!IMG) return;
    const cropRect = document.getElementById('cropRect');
    const h = e.target.dataset?.h;
    const isRect = e.target === cropRect || (cropRect && cropRect.contains(e.target));
    const c = imgCoords(e.clientX, e.clientY);
    cropDragging = true;
    cropDragStart = { x: c.x, y: c.y };
    cropStartCoords = { ...crop };
    cropDragMode = h ? h : isRect ? 'move' : 'new';
    if (cropDragMode === 'new') {
        crop = { x: c.x, y: c.y, w: 0, h: 0 };
        if (cropRect) cropRect.style.display = 'none';
    }
}

function moveCropDrag(e) {
    if (!cropDragging || !IMG) return;
    const c = imgCoords(e.clientX, e.clientY);
    const dx = c.x - cropDragStart.x, dy = c.y - cropDragStart.y;
    const useRatio = cropAR > 0;
    const sh = e.shiftKey;

    if (cropDragMode === 'new') {
        let nx = cropDragStart.x, ny = cropDragStart.y, nw = c.x - nx, nh = c.y - ny;
        if (nw < 0) { nx += nw; nw = -nw; }
        if (nh < 0) { ny += nh; nh = -nh; }
        if (useRatio) { nh = nw / cropAR; }
        else if (sh && nw > 0 && nh > 0) { nh = nw; }
        crop = { x: clamp(nx, 0, IMG.width), y: clamp(ny, 0, IMG.height), w: nw, h: nh };
    } else if (cropDragMode === 'move') {
        crop.x = clamp(cropStartCoords.x + dx, 0, IMG.width - cropStartCoords.w);
        crop.y = clamp(cropStartCoords.y + dy, 0, IMG.height - cropStartCoords.h);
        crop.w = cropStartCoords.w;
        crop.h = cropStartCoords.h;
    } else {
        let { x, y, w, h } = cropStartCoords, H = cropDragMode;
        if (H === 'rm' || H.includes('r')) { w = Math.max(1, cropStartCoords.w + dx); }
        if (H === 'lm' || H.includes('l')) { const nw = Math.max(1, cropStartCoords.w - dx); x += cropStartCoords.w - nw; w = nw; }
        if (H === 'bm' || H.includes('b')) { h = Math.max(1, cropStartCoords.h + dy); }
        if (H === 'tm' || H.includes('t')) { const nh = Math.max(1, cropStartCoords.h - dy); y += cropStartCoords.h - nh; h = nh; }
        if (sh || useRatio) {
            const ratio = useRatio ? cropAR : (cropStartCoords.h > 0 ? cropStartCoords.w / cropStartCoords.h : 1);
            if (H === 'bm' || H === 'tm') { w = h * ratio; } else { h = w / ratio; }
        }
        crop = { x: clamp(x, 0, IMG.width), y: clamp(y, 0, IMG.height), w, h };
    }
    renderCropRect();
    updateCropSelInfo();
}

function clamp(v, mn, mx) { return Math.min(Math.max(v, mn), mx); }

function renderCropRect() {
    const el = document.getElementById('cropImgEl');
    const cropRect = document.getElementById('cropRect');
    const cropInfoBar = document.getElementById('cropInfoBar');
    if (!IMG || !el || !cropRect) return;
    const r = el.getBoundingClientRect();
    if (!r.width || crop.w < 1) return;
    const sx = r.width / IMG.width, sy = r.height / IMG.height;
    cropRect.style.display = 'block';
    cropRect.style.left = (crop.x * sx) + 'px';
    cropRect.style.top = (crop.y * sy) + 'px';
    cropRect.style.width = (crop.w * sx) + 'px';
    cropRect.style.height = (crop.h * sy) + 'px';
    if (cropInfoBar) cropInfoBar.textContent = Math.round(crop.w) + '×' + Math.round(crop.h) + 'px';
}

function updateCropSelInfo() {
    const el = document.getElementById('cropSelInfo'), txt = document.getElementById('cropSelText');
    if (!el) return;
    if (crop.w > 1 && crop.h > 1) {
        el.style.display = 'block';
        if (txt) txt.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)} px`;
    } else {
        el.style.display = 'none';
    }
}

function doCrop() {
    if (!IMG) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }
    const x = Math.round(clamp(crop.x, 0, IMG.width)), y = Math.round(clamp(crop.y, 0, IMG.height));
    const w = Math.round(Math.min(crop.w, IMG.width - x)), h = Math.round(Math.min(crop.h, IMG.height - y));
    if (w < 2 || h < 2) { showEditorStatus('⚠️ Draw a crop rectangle on the canvas first.', 'err'); return; }
    showEditorProgress(true);
    const c = getCanvas(w, h);
    c.getContext('2d').drawImage(IMG, x, y, w, h, 0, 0, w, h);
    const url = c.toDataURL('image/png');
    resetCrop();
    setEditorResult(url, `Cropped ${w}×${h}px`);
}

function resetCrop() {
    if (!IMG) return;
    crop = { x: 0, y: 0, w: 0, h: 0 };
    const cropRect = document.getElementById('cropRect');
    if (cropRect) cropRect.style.display = 'none';
    updateCropSelInfo();
}

// ═══ 4. CONVERT FORMAT ═══
function liveConvert() {
    if (!IMG) return;
    const snap = IMG;
    canvasLivePreview(async () => {
        const fmt = document.getElementById('convFmt').value;
        const q = parseInt(document.getElementById('convQual').value, 10) / 100;
        const targetKB = parseFloat(document.getElementById('convTargetKB')?.value) || 0;

        if (targetKB > 0 && window.SmartOptimizationEngine && (fmt === 'image/jpeg' || fmt === 'image/webp' || fmt === 'image/avif')) {
            const res = await window.SmartOptimizationEngine.optimizeImage(snap, {
                format: fmt,
                targetKB,
                quality: q,
                isDocument: true
            });
            return res.dataUrl;
        }

        const c = getCanvas(snap.width, snap.height);
        if (fmt === 'image/png' || fmt === 'image/bmp' || fmt === 'image/tiff') {
            c.getContext('2d').clearRect(0, 0, c.width, c.height);
        }
        c.getContext('2d').drawImage(snap, 0, 0);
        return c.toDataURL(fmt, q);
    }, 100);
}

async function doConvert() {
    if (!IMG) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }
    showEditorProgress(true);
    const fmt = document.getElementById('convFmt').value;
    const q = parseInt(document.getElementById('convQual').value, 10) / 100;
    const targetKB = parseFloat(document.getElementById('convTargetKB')?.value) || 0;

    if (targetKB > 0 && window.SmartOptimizationEngine && (fmt === 'image/jpeg' || fmt === 'image/webp' || fmt === 'image/avif')) {
        const res = await window.SmartOptimizationEngine.optimizeImage(IMG, {
            format: fmt,
            targetKB,
            quality: q,
            isDocument: true
        });
        setEditorResult(res.dataUrl, `Converted to ${fmt.split('/')[1].toUpperCase()} (${res.statusMessage})`);
        return;
    }

    const c = getCanvas(IMG.width, IMG.height);
    c.getContext('2d').drawImage(IMG, 0, 0);
    setEditorResult(c.toDataURL(fmt, q), `Converted to ${fmt.split('/')[1].toUpperCase()}`);
}

// Integrated Flip & Rotation within Crop Tool (-90° to +90° Range & Steps)
let cropRotationAngle = 0;

function onCropAngleChange(val) {
    cropRotationAngle = Math.max(-90, Math.min(90, parseFloat(val) || 0));
    const slider = document.getElementById('cropRotAngleSlider');
    const numInput = document.getElementById('cropRotAngleInput');
    const angleLabel = document.getElementById('cropRotAngleVal');
    if (slider) slider.value = cropRotationAngle;
    if (numInput) numInput.value = cropRotationAngle;
    if (angleLabel) angleLabel.textContent = `${cropRotationAngle}°`;

    const cropImg = document.getElementById('cropImgEl');
    if (cropImg) {
        cropImg.style.transform = cropRotationAngle === 0 ? '' : `rotate(${cropRotationAngle}deg)`;
        cropImg.style.transition = 'transform 0.1s ease-out';
    }
}

function setCropAnglePreset(deg) {
    onCropAngleChange(deg);
}

function adjustCropAngleStep(delta) {
    onCropAngleChange(cropRotationAngle + delta);
}

function applyCropRotation() {
    if (!IMG) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }
    if (cropRotationAngle === 0) {
        showEditorStatus('ℹ️ Rotation angle is 0°. Select an angle from -90° to 90° to apply.', 'info');
        return;
    }
    showEditorProgress(true);
    const rad = cropRotationAngle * Math.PI / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const newW = Math.round(IMG.width * cos + IMG.height * sin);
    const newH = Math.round(IMG.width * sin + IMG.height * cos);

    const c = getCanvas(newW, newH);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(newW / 2, newH / 2);
    ctx.rotate(rad);
    ctx.drawImage(IMG, -IMG.width / 2, -IMG.height / 2);

    const appliedAngle = cropRotationAngle;
    cropRotationAngle = 0;
    onCropAngleChange(0);

    const url = c.toDataURL('image/png');
    setEditorResult(url, `Rotated ${appliedAngle}°`);
}

function cropFlip(dir) {
    if (!IMG) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }
    showEditorProgress(true);
    const c = getCanvas(IMG.width, IMG.height), ctx = c.getContext('2d');
    ctx.save();
    if (dir === 'h') { ctx.translate(IMG.width, 0); ctx.scale(-1, 1); }
    else { ctx.translate(0, IMG.height); ctx.scale(1, -1); }
    ctx.drawImage(IMG, 0, 0);
    ctx.restore();

    setEditorResult(c.toDataURL('image/png'), dir === 'h' ? 'Flipped Horizontal' : 'Flipped Vertical');
}

function cropRotate(deg) {
    if (!IMG) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }
    showEditorProgress(true);
    let ang = ((deg % 360) + 360) % 360;
    const sw = ang === 90 || ang === 270;
    const c = getCanvas(sw ? IMG.height : IMG.width, sw ? IMG.width : IMG.height), ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(ang * Math.PI / 180);
    ctx.drawImage(IMG, -IMG.width / 2, -IMG.height / 2);

    cropRotationAngle = 0;
    onCropAngleChange(0);

    setEditorResult(c.toDataURL('image/png'), `Rotated ${deg > 0 ? '+' : ''}${deg}°`);
}

// ═══ 7. BRIGHTNESS, CONTRAST, SATURATION, HUE ═══
function liveBrightness() {
    if (!IMG) return;
    const br = document.getElementById('brSlider').value;
    const ct = document.getElementById('ctSlider').value;
    const sat = document.getElementById('satSlider').value;
    const hue = document.getElementById('hueSlider').value;
    cssLivePreview(`brightness(${br}%) contrast(${ct}%) saturate(${sat}%) hue-rotate(${hue}deg)`);
}

function resetBrightness() {
    const brSlider = document.getElementById('brSlider');
    const ctSlider = document.getElementById('ctSlider');
    const satSlider = document.getElementById('satSlider');
    const hueSlider = document.getElementById('hueSlider');
    if (brSlider) brSlider.value = 100;
    if (ctSlider) ctSlider.value = 100;
    if (satSlider) satSlider.value = 100;
    if (hueSlider) hueSlider.value = 0;

    const brv = document.getElementById('brv');
    const ctv = document.getElementById('ctv');
    const satv = document.getElementById('satv');
    const huev = document.getElementById('huev');
    if (brv) brv.textContent = '100';
    if (ctv) ctv.textContent = '100';
    if (satv) satv.textContent = '100';
    if (huev) huev.textContent = '0';

    const livePreviewImg = document.getElementById('livePreviewImg');
    if (livePreviewImg) livePreviewImg.style.filter = 'none';
}

function doBrightness() {
    if (!IMG) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }
    showEditorProgress(true);
    const br = document.getElementById('brSlider').value;
    const ct = document.getElementById('ctSlider').value;
    const sat = document.getElementById('satSlider').value;
    const hue = document.getElementById('hueSlider').value;
    const c = getCanvas(IMG.width, IMG.height), ctx = c.getContext('2d');
    ctx.filter = `brightness(${br}%) contrast(${ct}%) saturate(${sat}%) hue-rotate(${hue}deg)`;
    ctx.drawImage(IMG, 0, 0);
    ctx.filter = 'none';
    setEditorResult(c.toDataURL('image/jpeg', 0.97), 'Adjustments applied');
}

// ═══ 11. WATERMARK ═══
let WM_POS = 'tc';
function setWMPos(btn) {
    document.querySelectorAll('.wm-pos-btn').forEach(b => b.classList.remove('active'));
    if (btn) {
        btn.classList.add('active');
        WM_POS = btn.dataset.p;
    }
    liveWatermark();
}

function liveWatermark() {
    if (!IMG) return;
    const snap = IMG;
    canvasLivePreview(() => {
        const text = document.getElementById('wmText').value || '© SMART VLE TOOL';
        const size = parseInt(document.getElementById('wmSize').value, 10) || 36;
        const color = document.getElementById('wmColor').value;
        const opacity = parseInt(document.getElementById('wmOpacity').value, 10) / 100;
        const c = getCanvas(snap.width, snap.height), ctx = c.getContext('2d');
        ctx.drawImage(snap, 0, 0);
        ctx.globalAlpha = opacity;
        ctx.font = `bold ${size}px Arial`;
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        const tw = ctx.measureText(text).width, pad = 20, p = WM_POS;
        const x = p.endsWith('l') ? pad : p.endsWith('r') ? snap.width - tw - pad : (snap.width - tw) / 2;
        const y = p.startsWith('t') ? pad : p.startsWith('b') ? snap.height - size - pad : (snap.height - size) / 2;
        ctx.fillText(text, x, y);
        ctx.globalAlpha = 1;
        return c.toDataURL('image/jpeg', 0.92);
    }, 80);
}

function doWatermark() {
    if (!IMG) { showEditorStatus('⚠️ Upload or import an image first.', 'err'); return; }
    showEditorProgress(true);
    const text = document.getElementById('wmText').value || '© SMART VLE TOOL';
    const size = parseInt(document.getElementById('wmSize').value, 10) || 36;
    const color = document.getElementById('wmColor').value;
    const opacity = parseInt(document.getElementById('wmOpacity').value, 10) / 100;
    const c = getCanvas(IMG.width, IMG.height), ctx = c.getContext('2d');
    ctx.drawImage(IMG, 0, 0);
    ctx.globalAlpha = opacity;
    ctx.font = `bold ${size}px Arial`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(text).width, pad = 20, p = WM_POS;
    const x = p.endsWith('l') ? pad : p.endsWith('r') ? IMG.width - tw - pad : (IMG.width - tw) / 2;
    const y = p.startsWith('t') ? pad : p.startsWith('b') ? IMG.height - size - pad : (IMG.height - size) / 2;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
    setEditorResult(c.toDataURL('image/jpeg', 0.97), 'Watermark added');
}

// ═══ 9. METADATA VIEWER ═══
function showMetadata() {
    if (!IMG) return;
    const metaTable = document.getElementById('metaTable');
    if (!metaTable) return;
    const rows = [
        ['📄 Name / Label', FNAME || 'image'],
        ['🎨 Format', IMG_FILE ? IMG_FILE.type : 'image/png'],
        ['📐 Dimensions', `${IMG.width} × ${IMG.height} px`],
        ['💾 Estimated Size', `${((IMG.src.length * 3 / 4) / 1024).toFixed(2)} KB`],
        ['📊 Aspect Ratio', (() => {
            const g = (a, b) => b ? g(b, a % b) : a;
            const d = g(IMG.width, IMG.height);
            return `${IMG.width / d} : ${IMG.height / d}`;
        })()],
        ['🕐 Timestamp', new Date().toLocaleString()]
    ];
    metaTable.innerHTML = '<table>' + rows.map(r => `<tr><td class="exif-key">${r[0]}</td><td class="exif-val">${r[1]}</td></tr>`).join('') + '</table>';
    metaTable.style.display = 'block';
}

// ═══ 11. IMAGE TO PDF (ENHANCED WORKSPACE & COMPILER) ═══
let img2pdfFiles = [];
let i2pDragSrc = null;
let i2pActiveIdx = 0;

function rotateImg2PdfPage(i, angleDelta) {
    if (i < 0 || i >= img2pdfFiles.length) return;
    const item = img2pdfFiles[i];
    item.rotation = ((item.rotation || 0) + angleDelta + 360) % 360;
    renderImg2PdfList();
    selectImg2PdfActive(i);
    showEditorStatus(`🔄 Image ${i + 1} rotated to ${item.rotation}°`, 'info');
}
window.rotateImg2PdfPage = rotateImg2PdfPage;

function rotateAllImg2PdfPages(angle, isReset = false) {
    if (!img2pdfFiles.length) return;
    img2pdfFiles.forEach(item => {
        if (isReset) {
            item.rotation = 0;
        } else {
            item.rotation = ((item.rotation || 0) + angle + 360) % 360;
        }
    });
    renderImg2PdfList();
    selectImg2PdfActive(i2pActiveIdx);
    showEditorStatus(isReset ? '↺ Reset rotation for all images to 0°' : `🔄 Rotated all images by ${angle}°`, 'info');
}
window.rotateAllImg2PdfPages = rotateAllImg2PdfPages;

function createImg2PdfThumbnail(file) {
    return new Promise((resolve) => {
        const tempUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            const maxDim = 350;
            const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const thumbUrl = canvas.toDataURL('image/jpeg', 0.80);
            URL.revokeObjectURL(tempUrl);
            resolve({
                thumbUrl,
                width: img.width,
                height: img.height
            });
        };
        img.onerror = () => {
            URL.revokeObjectURL(tempUrl);
            resolve(null);
        };
        img.src = tempUrl;
    });
}

async function addFilesToImg2Pdf(files) {
    const validFiles = files.filter(f => f.type.startsWith('image/') || f.name.match(/\.(jpe?g|png|webp|bmp|svg|avif|tiff?)$/i));
    if (!validFiles.length) return;
    showEditorStatus('⏳ Processing image thumbnails…', 'info');
    let added = 0;
    for (const f of validFiles) {
        const res = await createImg2PdfThumbnail(f);
        if (res) {
            img2pdfFiles.push({
                id: 'i2p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                file: f,
                thumbUrl: res.thumbUrl,
                previewUrl: null,
                width: res.width,
                height: res.height,
                name: f.name,
                rotation: 0
            });
            added++;
        }
    }
    if (added > 0) {
        i2pActiveIdx = img2pdfFiles.length - 1;
        renderImg2PdfList();
        showEditorStatus(`✅ Added ${added} image(s) to sequence.`, 'ok');
    }
}

function loadImg2Pdf(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    addFilesToImg2Pdf(files);
    input.value = '';
}

function handleImg2PdfDrop(e) {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    addFilesToImg2Pdf(files);
}

function renderImg2PdfList() {
    const list = document.getElementById('img2pdfList');
    const filmstrip = document.getElementById('i2pFilmstrip');
    const dropZone = document.getElementById('i2pDropZone');
    const contentContainer = document.getElementById('i2pContentContainer');
    const activePreview = document.getElementById('i2pActivePreview');
    const activeBadge = document.getElementById('i2pActiveBadge');
    const countLabel = document.getElementById('i2pCountLabel');
    const clearBtn = document.getElementById('i2pClearBtn');
    const dragHint = document.getElementById('i2pDragHint');
    const runBtn = document.getElementById('i2pRunBtn');
    if (!list) return;

    list.innerHTML = '';
    const n = img2pdfFiles.length;
    if (n === 0) {
        if (dropZone) dropZone.style.display = 'flex';
        if (contentContainer) contentContainer.style.display = 'none';
        if (filmstrip) filmstrip.style.display = 'none';
        if (countLabel) countLabel.textContent = '📄 No images uploaded yet';
        if (clearBtn) clearBtn.style.display = 'none';
        if (dragHint) dragHint.style.display = 'none';
        if (runBtn) runBtn.disabled = true;
        return;
    } else {
        if (dropZone) dropZone.style.display = 'none';
        if (contentContainer) contentContainer.style.display = 'flex';
        if (filmstrip) filmstrip.style.display = 'block';
        if (countLabel) countLabel.textContent = `📄 ${n} image${n !== 1 ? 's' : ''} in sequence`;
        if (clearBtn) clearBtn.style.display = '';
        if (dragHint) dragHint.style.display = n > 1 ? '' : 'none';
        if (runBtn) runBtn.disabled = false;
    }

    if (i2pActiveIdx >= n) i2pActiveIdx = Math.max(0, n - 1);
    const activeItem = img2pdfFiles[i2pActiveIdx];
    if (activePreview && activeItem) {
        if (!activeItem.previewUrl) activeItem.previewUrl = URL.createObjectURL(activeItem.file);
        activePreview.src = activeItem.previewUrl;
    }
    if (activeBadge && activeItem) {
        activeBadge.textContent = `Page ${i2pActiveIdx + 1} of ${n} • ${activeItem.name}`;
    }

    img2pdfFiles.forEach((item, i) => {
        const card = document.createElement('div');
        const isActive = i === i2pActiveIdx;
        const rot = item.rotation || 0;
        card.className = 'page-item-card' + (isActive ? ' active-page-card' : '');
        card.draggable = true;
        if (isActive) {
            card.style.outline = '2px solid var(--primary-accent)';
            card.style.background = '#f0f7ff';
        }
        card.innerHTML = `
            <div class="page-item-thumb-wrap" onclick="selectImg2PdfActive(${i})">
                <img src="${item.thumbUrl}" alt="Page ${i + 1}" class="page-item-thumb" style="transform: rotate(${rot}deg); transition: transform 0.2s ease;">
                <span class="page-item-badge">#${i + 1}${rot ? ' (' + rot + '°)' : ''}</span>
            </div>
            <div class="page-item-details">
                <div class="page-item-name" title="${item.name}" onclick="selectImg2PdfActive(${i})">${item.name}</div>
                <div class="page-item-controls">
                    <button class="page-item-btn" title="Rotate 90° Left" onclick="event.stopPropagation(); rotateImg2PdfPage(${i}, -90)">⟲</button>
                    <button class="page-item-btn" title="Rotate 90° Right" onclick="event.stopPropagation(); rotateImg2PdfPage(${i}, 90)">⟳</button>
                    <button class="page-item-btn" title="Flip 180°" onclick="event.stopPropagation(); rotateImg2PdfPage(${i}, 180)">180°</button>
                    <button class="page-item-btn remove" title="Remove Page" onclick="event.stopPropagation(); removeImg2Pdf(${i})">✕</button>
                </div>
            </div>`;

        card.addEventListener('dragstart', e => {
            i2pDragSrc = i;
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.querySelectorAll('#img2pdfList .page-item-card').forEach(c => c.classList.remove('drag-over'));
        });
        card.addEventListener('dragover', e => {
            e.preventDefault();
            card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', e => {
            e.preventDefault();
            card.classList.remove('drag-over');
            if (i2pDragSrc === null || i2pDragSrc === i) return;
            const moved = img2pdfFiles.splice(i2pDragSrc, 1)[0];
            img2pdfFiles.splice(i, 0, moved);
            i2pActiveIdx = i;
            i2pDragSrc = null;
            renderImg2PdfList();
        });
        list.appendChild(card);
    });
    selectImg2PdfActive(i2pActiveIdx);
}

function selectImg2PdfActive(idx) {
    if (idx < 0 || idx >= img2pdfFiles.length) return;
    i2pActiveIdx = idx;

    const cards = document.querySelectorAll('#img2pdfList .page-item-card');
    cards.forEach((card, i) => {
        if (i === idx) {
            card.classList.add('active-page-card');
            card.style.outline = '2px solid var(--primary-accent)';
            card.style.background = '#f0f7ff';
        } else {
            card.classList.remove('active-page-card');
            card.style.outline = '';
            card.style.background = '';
        }
    });

    const activePreview = document.getElementById('i2pActivePreview');
    const activeBadge = document.getElementById('i2pActiveBadge');
    const item = img2pdfFiles[idx];
    const rot = item ? (item.rotation || 0) : 0;

    if (activePreview && item) {
        if (!item.previewUrl) item.previewUrl = URL.createObjectURL(item.file);
        activePreview.src = item.previewUrl;
        activePreview.style.transform = `rotate(${rot}deg)`;
        activePreview.style.transition = 'transform 0.2s ease';
    }
    if (activeBadge && item) {
        activeBadge.textContent = `Page ${idx + 1} of ${img2pdfFiles.length} • ${item.name}${rot ? ' (' + rot + '°)' : ''}`;
    }
}
window.selectImg2PdfActive = selectImg2PdfActive;

function moveImg2Pdf(idx, dir) {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= img2pdfFiles.length) return;
    const item = img2pdfFiles.splice(idx, 1)[0];
    img2pdfFiles.splice(targetIdx, 0, item);
    i2pActiveIdx = targetIdx;
    renderImg2PdfList();
}

function removeImg2Pdf(i) {
    const item = img2pdfFiles[i];
    if (item && item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    img2pdfFiles.splice(i, 1);
    if (i2pActiveIdx >= img2pdfFiles.length) i2pActiveIdx = Math.max(0, img2pdfFiles.length - 1);
    renderImg2PdfList();
}

function clearImg2Pdf() {
    img2pdfFiles.forEach(item => { if (item.previewUrl) URL.revokeObjectURL(item.previewUrl); });
    img2pdfFiles = [];
    i2pActiveIdx = 0;
    const fileInput = document.getElementById('i2pFileInput');
    if (fileInput) fileInput.value = '';
    const activePreview = document.getElementById('i2pActivePreview');
    if (activePreview) activePreview.src = '';
    const statsEl = document.getElementById('i2pStats');
    if (statsEl) statsEl.style.display = 'none';
    renderImg2PdfList();
    showEditorStatus('Cleared image sequence.', 'info');
}

async function runImg2Pdf() {
    if (!img2pdfFiles.length) { showEditorStatus('⚠️ Add images first.', 'err'); return; }
    const runBtn = document.getElementById('i2pRunBtn');
    const pWrap = document.getElementById('i2pProgressWrap');
    const pBar = document.getElementById('i2pProgressBar');
    const statsEl = document.getElementById('i2pStats');

    if (runBtn) runBtn.disabled = true;
    if (pWrap) pWrap.classList.add('show');
    if (pBar) pBar.style.width = '0%';
    if (statsEl) statsEl.style.display = 'none';

    ensurePdfLibs(async () => {
        try {
            const pageSize = document.getElementById('i2pPageSize').value;
            const orient = document.getElementById('i2pOrientation').value;
            const baseQuality = parseFloat(document.getElementById('i2pQuality').value);
            const margin = parseFloat(document.getElementById('i2pMargin').value) || 0;
            const showPageNum = document.getElementById('i2pPageNum').value === 'yes';
            const targetVal = parseFloat(document.getElementById('i2pTargetVal').value);
            const targetUnit = document.getElementById('i2pTargetUnit').value;
            const targetKB = targetVal > 0 ? (targetUnit === 'MB' ? targetVal * 1024 : targetVal) : 0;
            const isDoc = document.getElementById('i2pDocProtection')?.checked !== false;

            if (pBar) pBar.style.width = '10%';
            showEditorStatus('⏳ Loading and preparing pristine images…', 'info');

            // Load pristine images
            const pages = [];
            for (let i = 0; i < img2pdfFiles.length; i++) {
                const item = img2pdfFiles[i];
                const tempUrl = URL.createObjectURL(item.file);
                const imgEl = await new Promise((res, rej) => {
                    const im = new Image();
                    im.onload = () => res(im);
                    im.onerror = rej;
                    im.src = tempUrl;
                });
                pages.push({
                    type: 'image',
                    imgElement: imgEl,
                    rotation: (item.rotation || 0) % 360,
                    sourceName: item.name,
                    origBytes: item.file.size,
                    _tempUrl: tempUrl
                });
                if (pBar) pBar.style.width = `${10 + Math.round((i / img2pdfFiles.length) * 20)}%`;
            }

            let result;
            if (window.SmartOptimizationEngine) {
                result = await window.SmartOptimizationEngine.optimizePdfSequence(pages, {
                    pageSize,
                    orientation: orient,
                    margin,
                    baseQuality,
                    showPageNum,
                    targetKB,
                    baseDpi: 150,
                    isCompress: true,
                    isDocument: isDoc
                }, (prog) => {
                    if (pBar) pBar.style.width = `${30 + Math.round((prog.percent || 0) * 0.7)}%`;
                    if (prog.status) showEditorStatus(`📄 ${prog.status}`, 'info');
                });
            } else {
                throw new Error('Optimization Engine not loaded');
            }

            // Clean up temporary image URLs
            pages.forEach(p => {
                if (p._tempUrl) URL.revokeObjectURL(p._tempUrl);
                if (p.imgElement) p.imgElement.src = '';
            });

            if (pBar) pBar.style.width = '100%';
            const blob = new Blob([result.buffer], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const defaultBase = 'monu_compiled_documents';
            const sizeKB = result.actualKB || (blob.size / 1024);
            const sizeStr = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(2)} MB` : `${sizeKB.toFixed(0)} KB`;
            const dimStr = `${img2pdfFiles.length} Page${img2pdfFiles.length !== 1 ? 's' : ''}`;

            const triggerFn = window.triggerDownloadWithFilenameModal || (typeof triggerDownloadWithFilenameModal === 'function' ? triggerDownloadWithFilenameModal : null);
            if (triggerFn) {
                triggerFn(url, defaultBase, 'pdf', dimStr, sizeStr, blob);
            } else {
                const chosenName = prompt("Enter file name for compiled PDF:", defaultBase);
                if (chosenName === null) return;
                const cleanName = chosenName.trim() ? chosenName.trim().replace(/\.pdf$/i, '') : defaultBase;
                const a = document.createElement('a');
                a.href = url;
                a.download = `${cleanName}.pdf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            }

            if (statsEl) {
                statsEl.style.display = 'block';
                const statusColor = result.targetReached ? '#10b981' : (result.bestSafeResult ? '#d97706' : '#2563eb');
                statsEl.innerHTML = `✅ <strong>PDF created!</strong> ${img2pdfFiles.length} pages | <strong>${sizeKB >= 1024 ? (sizeKB / 1024).toFixed(2) + ' MB' : sizeKB.toFixed(0) + ' KB'}</strong> | <span style="color:${statusColor}; font-weight:700;">${result.statusMessage}</span>`;
            }
            showEditorStatus(`✅ ${result.statusMessage}. Choose filename to download PDF.`, 'ok');
        } catch (err) {
            showEditorStatus('❌ Error: ' + err.message, 'err');
            console.error(err);
        }
        if (runBtn) runBtn.disabled = false;
        setTimeout(() => { if (pWrap) pWrap.classList.remove('show'); }, 800);
    });
}

// ═══ 18. PDF COMPRESS & OPTIMIZER (UNIFIED MULTI-FILE SEQUENCE) ═══
let pdfOptPages = []; // Array of { id, type: 'pdf'|'image', sourceName, origBytes, thumbUrl, pdfDoc, pdfPageNum, totalPagesInDoc, imgElement, rotation }
let pdfOptDragSrc = null;
let pdfOptActiveIdx = 0;
let PDF_MODE = 'compress';
let PDF_RESULT = null;
let PDF_TOTAL_ORIG_BYTES = 0;

function rotatePdfOptPage(i, angleDelta) {
    if (i < 0 || i >= pdfOptPages.length) return;
    const item = pdfOptPages[i];
    item.rotation = ((item.rotation || 0) + angleDelta + 360) % 360;
    renderPdfOptPages();
    selectPdfOptActive(i);
    showEditorStatus(`🔄 Page ${i + 1} rotated to ${item.rotation}°`, 'info');
}
window.rotatePdfOptPage = rotatePdfOptPage;

function rotateAllPdfOptPages(angle, isReset = false) {
    if (!pdfOptPages.length) return;
    pdfOptPages.forEach(item => {
        if (isReset) {
            item.rotation = 0;
        } else {
            item.rotation = ((item.rotation || 0) + angle + 360) % 360;
        }
    });
    renderPdfOptPages();
    selectPdfOptActive(pdfOptActiveIdx);
    showEditorStatus(isReset ? '↺ Reset rotation for all pages to 0°' : `🔄 Rotated all pages by ${angle}°`, 'info');
}
window.rotateAllPdfOptPages = rotateAllPdfOptPages;

function ensurePdfLibs(cb) {
    if (window.pdfjsLib && window.jspdf) { cb(); return; }
    showEditorStatus('⏳ Loading PDF components…', 'info');
    const s1 = document.createElement('script');
    s1.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    s1.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        const s2 = document.createElement('script');
        s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s2.onload = () => { cb(); };
        document.head.appendChild(s2);
    };
    document.head.appendChild(s1);
}

function setPdfMode(mode, btn) {
    PDF_MODE = mode;
    document.querySelectorAll('#pdfModeTabs .sm-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('pdfCompressSettings').style.display = mode === 'compress' ? '' : 'none';
    document.getElementById('pdfIncreaseSettings').style.display = mode === 'increase' ? '' : 'none';
    updatePdfEstimate();
}

async function loadPDF(input) {
    const files = Array.from(input.files || []);
    if (!files.length) return;
    await addFilesToPdfOptimizer(files);
    input.value = '';
}

function loadPDFOptFiles(input) {
    return loadPDF(input);
}

function handlePdfOptDrop(e) {
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    addFilesToPdfOptimizer(files);
}

async function loadPdfDocumentSafe(data, filename, onStatus) {
    let attempts = 0;
    try {
        const loadingTask = window.pdfjsLib.getDocument({
            data: data,
            onPassword: (updatePassword, reason) => {
                attempts++;
                if (attempts > 3) {
                    if (onStatus) onStatus(`🔒 Password limit exceeded for ${filename}`, 'err');
                    updatePassword(new Error('Password attempts exceeded'));
                    return;
                }
                let pwd = null;
                try {
                    const promptText = reason === 1
                        ? `🔒 "${filename}" is password protected.\nPlease enter the PDF Password:`
                        : `❌ Incorrect password for "${filename}".\nPlease enter the correct password:`;
                    pwd = window.prompt(promptText);
                } catch (e) {
                    console.warn('window.prompt unavailable or restricted:', e);
                }
                if (pwd !== null && pwd !== '') {
                    updatePassword(pwd);
                } else {
                    updatePassword(new Error('Password entry cancelled'));
                }
            }
        });
        return await loadingTask.promise;
    } catch (err) {
        if (err.name === 'PasswordException' || (err.message && err.message.toLowerCase().includes('password'))) {
            throw new Error(`Password protected or password incorrect for "${filename}".`);
        }
        throw err;
    }
}

async function addFilesToPdfOptimizer(files) {
    const runBtn = document.getElementById('pdfRunBtn');
    if (runBtn) runBtn.disabled = true;
    showEditorStatus('⏳ Reading & generating page thumbnails…', 'info');
    showEditorProgress(true);

    ensurePdfLibs(async () => {
        const errors = [];
        let addedCount = 0;
        try {
            for (const file of files) {
                try {
                    if (file.type === 'application/pdf' || file.name.match(/\.pdf$/i)) {
                        const arrayBuf = await file.arrayBuffer();
                        const pdfDoc = await loadPdfDocumentSafe(arrayBuf, file.name, (msg, type) => showEditorStatus(msg, type));
                        if (!pdfDoc) continue;
                        const numPages = pdfDoc.numPages;
                        const bytesPerPage = Math.round(file.size / numPages);

                        for (let p = 1; p <= numPages; p++) {
                            const page = await pdfDoc.getPage(p);
                            const vp = page.getViewport({ scale: 0.22 });
                            const canvas = document.createElement('canvas');
                            canvas.width = vp.width;
                            canvas.height = vp.height;
                            const ctx = canvas.getContext('2d');
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, canvas.width, canvas.height);
                            await page.render({ canvasContext: ctx, viewport: vp }).promise;
                            const thumbUrl = canvas.toDataURL('image/jpeg', 0.85);

                            pdfOptPages.push({
                                id: 'pdf_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                                type: 'pdf',
                                sourceName: file.name,
                                origBytes: bytesPerPage,
                                thumbUrl: thumbUrl,
                                pdfDoc: pdfDoc,
                                pdfPageNum: p,
                                totalPagesInDoc: numPages
                            });
                            addedCount++;
                        }
                    } else if (file.type.startsWith('image/') || file.name.match(/\.(jpe?g|png|webp|bmp|svg|avif|tiff?)$/i)) {
                        const dataUrl = await new Promise((res, rej) => {
                            const r = new FileReader();
                            r.onload = e => res(e.target.result);
                            r.onerror = rej;
                            r.readAsDataURL(file);
                        });
                        const img = await new Promise((res, rej) => {
                            const im = new Image();
                            im.onload = () => res(im);
                            im.onerror = rej;
                            im.src = dataUrl;
                        });

                        const maxDim = 180;
                        const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
                        const c = document.createElement('canvas');
                        c.width = img.width * scale;
                        c.height = img.height * scale;
                        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                        const thumbUrl = c.toDataURL('image/jpeg', 0.85);

                        pdfOptPages.push({
                            id: 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                            type: 'image',
                            sourceName: file.name,
                            origBytes: file.size,
                            thumbUrl: thumbUrl,
                            imgElement: img
                        });
                        addedCount++;
                    }
                } catch (fileErr) {
                    console.warn(`Error adding file "${file.name}":`, fileErr);
                    errors.push(`${file.name}: ${fileErr.message || 'Could not load'}`);
                }
            }
            if (pdfOptPages.length > 0) {
                pdfOptActiveIdx = pdfOptPages.length - 1;
                renderPdfOptPages();
                updatePdfEstimate();
            }
            if (errors.length > 0) {
                showEditorStatus(`⚠️ ${errors.join(' | ')}`, 'err');
            } else if (addedCount > 0) {
                showEditorStatus(`✅ ${pdfOptPages.length} total pages in sequence ready for optimization.`, 'ok');
            }
        } catch (err) {
            console.error('Error adding files to PDF optimizer:', err);
            showEditorStatus('❌ ' + err.message, 'err');
        } finally {
            finishEditorProgress();
        }
    });
}

function renderPdfOptPages() {
    const list = document.getElementById('pdfOptPagesList');
    const container = document.getElementById('pdfOptPagesContainer');
    const dropZone = document.getElementById('pdfOptDropZone');
    const contentContainer = document.getElementById('pdfOptContentContainer');
    const activeImg = document.getElementById('pdfOptActiveImg');
    const activeBadge = document.getElementById('pdfOptActiveBadge');
    const totalPagesBadge = document.getElementById('pdfOptTotalPages');
    const countLabel = document.getElementById('pdfOptCountLabel');
    const clearBtn = document.getElementById('pdfOptClearBtn');
    const runBtn = document.getElementById('pdfRunBtn');
    const resCard = document.getElementById('pdfResultCard');
    const dlBtn = document.getElementById('pdfDownloadBtn');
    if (!list) return;

    list.innerHTML = '';
    const n = pdfOptPages.length;

    if (n === 0) {
        if (dropZone) dropZone.style.display = 'flex';
        if (contentContainer) contentContainer.style.display = 'none';
        if (container) container.style.display = 'none';
        if (countLabel) countLabel.textContent = '📄 No documents or pages uploaded';
        if (clearBtn) clearBtn.style.display = 'none';
        if (runBtn) runBtn.disabled = true;
        if (resCard) resCard.style.display = 'none';
        if (dlBtn) dlBtn.style.display = 'none';
        const estBar = document.getElementById('pdfEstimateBar');
        if (estBar) estBar.style.display = 'none';
        return;
    }

    if (dropZone) dropZone.style.display = 'none';
    if (contentContainer) contentContainer.style.display = 'flex';
    if (container) container.style.display = 'flex';
    if (clearBtn) clearBtn.style.display = '';
    if (runBtn) runBtn.disabled = false;

    // Calculate total original bytes
    PDF_TOTAL_ORIG_BYTES = pdfOptPages.reduce((acc, p) => acc + (p.origBytes || 0), 0);
    const totalKB = PDF_TOTAL_ORIG_BYTES / 1024;
    const totalStr = totalKB >= 1024 ? `${(totalKB / 1024).toFixed(2)} MB` : `${totalKB.toFixed(1)} KB`;

    if (countLabel) {
        countLabel.textContent = `📄 ${n} Page${n !== 1 ? 's' : ''} in Sequence (~${totalStr})`;
    }
    if (totalPagesBadge) {
        totalPagesBadge.textContent = n;
    }

    if (pdfOptActiveIdx >= n) pdfOptActiveIdx = Math.max(0, n - 1);
    const activeItem = pdfOptPages[pdfOptActiveIdx];
    if (activeImg && activeItem) {
        activeImg.src = activeItem.thumbUrl;
    }
    if (activeBadge && activeItem) {
        activeBadge.textContent = `Page ${pdfOptActiveIdx + 1} of ${n} • ${activeItem.sourceName}`;
    }

    pdfOptPages.forEach((item, i) => {
        const card = document.createElement('div');
        const isActive = i === pdfOptActiveIdx;
        const rot = item.rotation || 0;
        card.className = 'page-item-card' + (isActive ? ' active-page-card' : '');
        card.draggable = true;
        if (isActive) {
            card.style.outline = '2px solid var(--primary-accent)';
            card.style.background = '#f0f7ff';
        }

        card.innerHTML = `
            <div class="page-item-thumb-wrap" onclick="selectPdfOptActive(${i})">
                <img src="${item.thumbUrl}" alt="Page ${i + 1}" class="page-item-thumb" style="transform: rotate(${rot}deg); transition: transform 0.2s ease;">
                <span class="page-item-badge">#${i + 1}${rot ? ' (' + rot + '°)' : ''}</span>
            </div>
            <div class="page-item-details">
                <div class="page-item-name" title="${item.sourceName}" onclick="selectPdfOptActive(${i})">${item.sourceName}</div>
                <div class="page-item-controls">
                    <button class="page-item-btn" title="Rotate 90° Left" onclick="event.stopPropagation(); rotatePdfOptPage(${i}, -90)">⟲</button>
                    <button class="page-item-btn" title="Rotate 90° Right" onclick="event.stopPropagation(); rotatePdfOptPage(${i}, 90)">⟳</button>
                    <button class="page-item-btn" title="Flip 180°" onclick="event.stopPropagation(); rotatePdfOptPage(${i}, 180)">180°</button>
                    <button class="page-item-btn remove" title="Remove Page" onclick="event.stopPropagation(); removePdfOptPage(${i})">✕</button>
                </div>
            </div>`;

        card.addEventListener('dragstart', e => {
            pdfOptDragSrc = i;
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.querySelectorAll('#pdfOptPagesList .page-item-card').forEach(c => c.classList.remove('drag-over'));
        });
        card.addEventListener('dragover', e => {
            e.preventDefault();
            card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
        card.addEventListener('drop', e => {
            e.preventDefault();
            card.classList.remove('drag-over');
            if (pdfOptDragSrc === null || pdfOptDragSrc === i) return;
            const moved = pdfOptPages.splice(pdfOptDragSrc, 1)[0];
            pdfOptPages.splice(i, 0, moved);
            pdfOptActiveIdx = i;
            pdfOptDragSrc = null;
            renderPdfOptPages();
            updatePdfEstimate();
        });

        list.appendChild(card);
    });
    selectPdfOptActive(pdfOptActiveIdx);
}

async function selectPdfOptActive(idx) {
    if (idx < 0 || idx >= pdfOptPages.length) return;
    pdfOptActiveIdx = idx;

    const cards = document.querySelectorAll('#pdfOptPagesList .page-item-card');
    cards.forEach((card, i) => {
        if (i === idx) {
            card.classList.add('active-page-card');
            card.style.outline = '2px solid var(--primary-accent)';
            card.style.background = '#f0f7ff';
        } else {
            card.classList.remove('active-page-card');
            card.style.outline = '';
            card.style.background = '';
        }
    });

    const activeBadge = document.getElementById('pdfOptActiveBadge');
    const item = pdfOptPages[idx];

    const rot = item ? (item.rotation || 0) : 0;
    if (activeBadge && item) {
        activeBadge.textContent = `Page ${idx + 1} of ${pdfOptPages.length} • ${item.sourceName}${rot ? ' (' + rot + '°)' : ''}`;
    }

    const activeImg = document.getElementById('pdfOptActiveImg');
    if (activeImg && item) {
        activeImg.style.transform = `rotate(${rot}deg)`;
        activeImg.style.transition = 'transform 0.2s ease';
        if (item.highResUrl) {
            activeImg.src = item.highResUrl;
        } else if (item.type === 'pdf' && item.pdfDoc && item.pdfPageNum) {
            try {
                // Render high resolution (viewport scale 1.5) preview canvas
                const page = await item.pdfDoc.getPage(item.pdfPageNum);
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement('canvas');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
                item.highResUrl = canvas.toDataURL('image/jpeg', 0.90);
                activeImg.src = item.highResUrl;
            } catch (err) {
                console.warn('Failed to render high-res PDF preview:', err);
                activeImg.src = item.thumbUrl;
            }
        } else if (item.type === 'image' && item.imgElement) {
            activeImg.src = item.imgElement.src;
        } else {
            activeImg.src = item.thumbUrl;
        }
    }
}
window.selectPdfOptActive = selectPdfOptActive;

function movePdfOptPage(idx, dir) {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= pdfOptPages.length) return;
    const item = pdfOptPages.splice(idx, 1)[0];
    pdfOptPages.splice(targetIdx, 0, item);
    pdfOptActiveIdx = targetIdx;
    renderPdfOptPages();
    updatePdfEstimate();
}

function removePdfOptPage(i) {
    pdfOptPages.splice(i, 1);
    if (pdfOptActiveIdx >= pdfOptPages.length) pdfOptActiveIdx = Math.max(0, pdfOptPages.length - 1);
    renderPdfOptPages();
    updatePdfEstimate();
}

function clearPdfOptPages() {
    pdfOptPages = [];
    pdfOptActiveIdx = 0;
    PDF_RESULT = null;
    const fileInput = document.getElementById('pdfFileInput');
    if (fileInput) fileInput.value = '';
    const activeImg = document.getElementById('pdfOptActiveImg');
    if (activeImg) activeImg.src = '';
    const resCard = document.getElementById('pdfResultCard');
    if (resCard) resCard.style.display = 'none';
    const dlBtn = document.getElementById('pdfDownloadBtn');
    if (dlBtn) dlBtn.style.display = 'none';
    const estBar = document.getElementById('pdfEstimateBar');
    if (estBar) estBar.style.display = 'none';
    renderPdfOptPages();
    showEditorStatus('Cleared PDF sequence.', 'info');
}
const clearPDFOptPages = clearPdfOptPages;
window.clearPDFOptPages = clearPdfOptPages;

function updatePdfEstimate() {
    if (!pdfOptPages.length) return;
    const origKB = PDF_TOTAL_ORIG_BYTES / 1024 || (pdfOptPages.length * 120);
    let est;
    if (PDF_MODE === 'compress') {
        const preset = document.getElementById('pdfQualPreset').value;
        const qual = parseFloat(document.getElementById('pdfJpegQual').value);
        const dpiMap = { screen: 0.20, ebook: 0.38, printer: 0.65, custom: 0.45 };
        est = origKB * (dpiMap[preset] || 0.35) * qual * 1.3;
    } else {
        const dpi = parseInt(document.getElementById('pdfIncDpi').value, 10);
        const qual = parseFloat(document.getElementById('pdfIncJpegQual').value);
        est = origKB * (dpi / 150) * qual * 2.0;
    }
    const estStr = est >= 1024 ? `~${(est / 1024).toFixed(2)} MB` : `~${est.toFixed(0)} KB`;
    const origStr = origKB >= 1024 ? `${(origKB / 1024).toFixed(2)} MB` : `${origKB.toFixed(0)} KB`;
    
    const bar = document.getElementById('pdfEstimateBar');
    if (bar) bar.style.display = 'block';
    const change = origKB > 0 ? ((est - origKB) / origKB * 100) : 0;
    const estText = document.getElementById('pdfEstText');
    if (estText) {
        estText.innerHTML = `${change < 0 ? '🔽' : '🔼'} Est: <strong>${estStr}</strong> (orig: ${origStr}) | ${change < 0 ? 'Estimated Saving' : 'Estimated Increase'} ~<strong>${Math.abs(change).toFixed(0)}%</strong>`;
    }
}

function getTargetKB() {
    if (PDF_MODE === 'compress') {
        const val = parseFloat(document.getElementById('pdfTargetVal').value);
        const unit = document.getElementById('pdfTargetUnit').value;
        if (!val) return 0;
        return unit === 'MB' ? val * 1024 : val;
    } else {
        const val = parseFloat(document.getElementById('pdfIncTargetVal').value);
        const unit = document.getElementById('pdfIncTargetUnit').value;
        if (!val) return 0;
        return unit === 'MB' ? val * 1024 : val;
    }
}

async function runPDF() {
    if (!pdfOptPages.length) { showEditorStatus('⚠️ Add PDF or image files first.', 'err'); return; }
    document.getElementById('pdfRunBtn').disabled = true;
    document.getElementById('pdfDownloadBtn').style.display = 'none';
    document.getElementById('pdfResultCard').style.display = 'none';
    document.getElementById('pdfProcessWrap').style.display = 'block';
    document.getElementById('pdfProcBar').style.width = '0%';
    const totalPages = pdfOptPages.length;
    const isCompress = PDF_MODE === 'compress';
    const targetKB = getTargetKB();

    let dpi;
    if (isCompress) {
        const preset = document.getElementById('pdfQualPreset').value;
        const dpiMap = { screen: 72, ebook: 150, printer: 300, custom: parseInt(document.getElementById('pdfCustomDpi')?.value, 10) || 150 };
        dpi = dpiMap[preset] || 150;
    } else {
        dpi = parseInt(document.getElementById('pdfIncDpi').value, 10) || 300;
    }
    let jpegQual = parseFloat(isCompress ? document.getElementById('pdfJpegQual').value : document.getElementById('pdfIncJpegQual').value);
    const scale = dpi / 72;
    const { jsPDF } = window.jspdf;
    const origBytes = PDF_TOTAL_ORIG_BYTES || 1;

    const pageSize = document.getElementById('pdfPageSize') ? document.getElementById('pdfPageSize').value : 'fit';
    const orientOpt = document.getElementById('pdfOrientation') ? document.getElementById('pdfOrientation').value : 'auto';
    const margin = document.getElementById('pdfMargin') ? parseFloat(document.getElementById('pdfMargin').value) : 0;
    const showPageNum = document.getElementById('pdfPageNum') ? (document.getElementById('pdfPageNum').value === 'yes') : false;
    const pageDimMap = { a4: [210, 297], a3: [297, 420], letter: [216, 279], fit: null };
    const baseDim = pageDimMap[pageSize];

    const isDoc = document.getElementById('pdfDocProtection')?.checked !== false;

    try {
        document.getElementById('pdfProcLabel').textContent = isCompress ? '🗜️ Optimizing & Compiling Sequence…' : '📈 Rebuilding Sequence with Higher Fidelity…';

        let result;
        if (window.SmartOptimizationEngine) {
            result = await window.SmartOptimizationEngine.optimizePdfSequence(pdfOptPages, {
                pageSize,
                orientation: orientOpt,
                margin,
                showPageNum,
                baseDpi: dpi,
                baseQuality: jpegQual,
                targetKB,
                isCompress,
                isDocument: isDoc
            }, (prog) => {
                if (prog.percent !== undefined) {
                    document.getElementById('pdfProcBar').style.width = prog.percent + '%';
                    document.getElementById('pdfProcPct').textContent = prog.percent + '%';
                }
                if (prog.status) {
                    document.getElementById('pdfProcSub').textContent = prog.status;
                }
            });
        } else {
            throw new Error('Smart Optimization Engine not loaded');
        }

        document.getElementById('pdfProcBar').style.width = '100%';
        document.getElementById('pdfProcPct').textContent = '100%';
        PDF_RESULT = result.buffer;
        const totalBytes = PDF_RESULT.byteLength;
        const origKB = origBytes / 1024, newKB = totalBytes / 1024, change = ((newKB - origKB) / origKB * 100);
        document.getElementById('pdfResOrig').textContent = origKB >= 1024 ? `${(origKB / 1024).toFixed(2)} MB` : `${origKB.toFixed(1)} KB`;
        document.getElementById('pdfResNew').textContent = newKB >= 1024 ? `${(newKB / 1024).toFixed(2)} MB` : `${newKB.toFixed(1)} KB`;
        document.getElementById('pdfResChange').innerHTML = `<span style="color:${change < 0 ? '#10b981' : '#E02424'}">${change < 0 ? '▼' : '▲'} ${Math.abs(change).toFixed(1)}%</span>`;
        document.getElementById('pdfResultCard').style.display = 'block';
        document.getElementById('pdfDownloadBtn').style.display = '';

        let statusText = `✅ PDF processed! Total ${totalPages} pages compiled (${Math.abs(change).toFixed(1)}% change). ${result.statusMessage}`;
        showEditorStatus(statusText, 'ok');
    } catch (err) {
        showEditorStatus('❌ ' + err.message, 'err');
        console.error(err);
    }
    document.getElementById('pdfRunBtn').disabled = false;
}

function downloadPDF() {
    if (!PDF_RESULT) { showEditorStatus('⚠️ Process PDF first.', 'err'); return; }
    const blob = new Blob([PDF_RESULT], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const defaultBase = 'monu_optimized_sequence_' + (PDF_MODE === 'compress' ? 'compressed' : 'enhanced');
    const sizeKB = blob.size / 1024;
    const sizeStr = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(2)} MB` : `${sizeKB.toFixed(0)} KB`;
    const dimStr = `${pdfOptPages.length} Page${pdfOptPages.length !== 1 ? 's' : ''}`;

    const triggerFn = window.triggerDownloadWithFilenameModal || (typeof triggerDownloadWithFilenameModal === 'function' ? triggerDownloadWithFilenameModal : null);
    if (triggerFn) {
        triggerFn(url, defaultBase, 'pdf', dimStr, sizeStr, blob);
    } else {
        const chosenName = prompt("Enter file name for optimized PDF:", defaultBase);
        if (chosenName === null) return;
        const cleanName = chosenName.trim() ? chosenName.trim().replace(/\.pdf$/i, '') : defaultBase;
        const a = document.createElement('a');
        a.href = url;
        a.download = `${cleanName}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    showEditorStatus('⬇️ Choose filename to download PDF.', 'ok');
}

// ═══ DRAG & DROP BINDINGS ═══
window.addEventListener('DOMContentLoaded', () => {
    const uz = document.getElementById('editorUploadZone');
    const fileInput = document.getElementById('editorFileInput');
    if (uz && fileInput) {
        uz.addEventListener('dragover', e => { e.preventDefault(); uz.classList.add('dragover'); });
        uz.addEventListener('dragleave', () => uz.classList.remove('dragover'));
        uz.addEventListener('drop', e => {
            e.preventDefault();
            uz.classList.remove('dragover');
            const f = e.dataTransfer.files[0];
            if (f && (f.type.startsWith('image/') || f.name.match(/\.(svg|avif|tiff?|bmp|png|jpe?g|webp)$/i))) {
                try {
                    const dt = new DataTransfer();
                    dt.items.add(f);
                    fileInput.files = dt.files;
                    loadEditorImg(fileInput);
                } catch (_) {
                    const r = new FileReader();
                    r.onload = ev => {
                        IMG_FILE = f;
                        FNAME = f.name.replace(/\.[^.]+$/, '');
                        const img = new Image();
                        img.onload = () => {
                            IMG = img;
                            HISTORY = [];
                            HIST_IDX = -1;
                            const src = ev.target.result;
                            document.getElementById('origImg').src = src;
                            document.getElementById('livePreviewImg').src = src;
                            uz.style.display = 'none';
                            const sp = document.getElementById('editorSinglePreview');
                            if (sp) sp.style.display = 'flex';
                            const chBtn = document.getElementById('changeImgBtn');
                            const rsBtn = document.getElementById('resetImgBtn');
                            const delBtn = document.getElementById('deleteImgBtn');
                            if (chBtn) chBtn.style.display = '';
                            if (rsBtn) rsBtn.style.display = '';
                            if (delBtn) delBtn.style.display = '';
                            pushHistory(src, 'Original');
                            showEditorStatus('✅ Image loaded!', 'ok');
                            updateImageInfoBar(img, src, FNAME, f);
                            if (TOOL === 'crop') initCropDisplay();
                            switchTool(TOOL, null);
                        };
                        img.src = ev.target.result;
                    };
                    r.readAsDataURL(f);
                }
            }
        });
    }

    // PDF Optimizer drag & drop on drop zone
    const pdfOptDrop = document.getElementById('pdfOptDropZone');
    if (pdfOptDrop) {
        pdfOptDrop.addEventListener('dragover', e => { e.preventDefault(); pdfOptDrop.classList.add('dragover'); });
        pdfOptDrop.addEventListener('dragleave', () => pdfOptDrop.classList.remove('dragover'));
        pdfOptDrop.addEventListener('drop', e => {
            e.preventDefault();
            pdfOptDrop.classList.remove('dragover');
            handlePdfOptDrop(e);
        });
    }

    // Img to PDF drag & drop on drop zone
    const i2pDrop = document.getElementById('i2pDropZone');
    if (i2pDrop) {
        i2pDrop.addEventListener('dragover', e => { e.preventDefault(); i2pDrop.classList.add('dragover'); });
        i2pDrop.addEventListener('dragleave', () => i2pDrop.classList.remove('dragover'));
        i2pDrop.addEventListener('drop', e => {
            e.preventDefault();
            i2pDrop.classList.remove('dragover');
            handleImg2PdfDrop(e);
        });
    }

    // Enable smooth mouse wheel scrolling for thumbnail lists
    ['img2pdfList', 'pdfOptPagesList'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('wheel', (e) => {
                if (el.scrollHeight > el.clientHeight) {
                    el.scrollTop += e.deltaY;
                    e.preventDefault();
                }
            }, { passive: false });
        }
    });
});
