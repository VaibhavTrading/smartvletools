/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

let imageArray = []; 
let bucketPairs = []; 
let activeBucketIdx = -1; 
let activeIndex = -1; 
let activeHandle = null; 
let currentMode = 'DOC';
let cvReady = false; 
let liveTransformFrame = null; 
let transformTimer = null;
let shadowRemovalActive = false;
let docPrintState = { x: 0, y: 0, scale: 1, dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0 };
let filterMode = 'GRAYSCALE'; 
let idLeftCanvas = null; 
let idRightCanvas = null; 
let activeSlot = null; // 'left' (Slot 1 / Top) or 'right' (Slot 2 / Bottom) or null
let idSlotGeometry = { slot1: null, slot2: null }; // Cached coordinates of slots on canvas-dst
let tempCurrentCroppedCanvas = null;
function isValidCornerQuad(c) {
    if (!c || !c.tl || !c.tr || !c.br || !c.bl) return false;
    let topW = Math.hypot((c.tr.x || 0) - (c.tl.x || 0), (c.tr.y || 0) - (c.tl.y || 0));
    let botW = Math.hypot((c.br.x || 0) - (c.bl.x || 0), (c.br.y || 0) - (c.bl.y || 0));
    let leftH = Math.hypot((c.bl.x || 0) - (c.tl.x || 0), (c.bl.y || 0) - (c.tl.y || 0));
    let rightH = Math.hypot((c.br.x || 0) - (c.tr.x || 0), (c.br.y || 0) - (c.tr.y || 0));
    return (topW > 10 || botW > 10) && (leftH > 10 || rightH > 10);
}
let corners = { tl: {x:0, y:0}, tr: {x:100, y:0}, br: {x:100, y:100}, bl: {x:0, y:100} };
let zoomSrc = 1.0, panSrc = { x: 0, y: 0 };
let zoomDst = 1.0, panDst = { x: 0, y: 0 };

function updateContainerTransform(type) {
    let container = document.getElementById(type === 'src' ? 'container-src' : (currentMode === 'ID' ? 'container-id-dst' : 'container-dst'));
    let zoom = type === 'src' ? zoomSrc : zoomDst;
    let pan = type === 'src' ? panSrc : panDst;
    if (container) {
        container.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
        container.style.transformOrigin = 'center center';
    }
}

function initViewportPanAndZoom() {
    ['src', 'dst'].forEach(type => {
        let vp = document.getElementById(`viewport-${type}`);
        let container = document.getElementById(`container-${type}`);
        if (!vp || !container) return;

        let isPanning = false;
        let startX = 0, startY = 0;
        let basePanX = 0, basePanY = 0;

        vp.addEventListener('wheel', function(e) {
            e.preventDefault();
            if (type === 'src' && imageArray.length === 0) return;
            let factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            if (type === 'src') {
                zoomSrc = Math.max(0.2, Math.min(10.0, zoomSrc * factor));
                updateContainerTransform('src');
                let badge = document.getElementById('badge-src-dim');
                if (badge) badge.innerText = `Zoom: ${Math.round(zoomSrc * 100)}%`;
            } else {
                zoomDst = Math.max(0.2, Math.min(10.0, zoomDst * factor));
                updateContainerTransform('dst');
                let badge = document.getElementById('badge-dst-dim');
                if (badge) badge.innerText = `Zoom: ${Math.round(zoomDst * 100)}%`;
            }
        }, { passive: false });

        vp.addEventListener('mousedown', function(e) {
            if (e.target.classList.contains('corner-handle')) return;
            if (type === 'src' && imageArray.length === 0) return;
            isPanning = true;
            startX = e.clientX;
            startY = e.clientY;
            basePanX = (type === 'src' ? panSrc.x : panDst.x);
            basePanY = (type === 'src' ? panSrc.y : panDst.y);
            vp.classList.add('panning');
            e.preventDefault();
        });

        window.addEventListener('mousemove', function(e) {
            if (!isPanning) return;
            let dx = e.clientX - startX;
            let dy = e.clientY - startY;
            if (type === 'src') {
                panSrc.x = basePanX + dx;
                panSrc.y = basePanY + dy;
                updateContainerTransform('src');
            } else {
                panDst.x = basePanX + dx;
                panDst.y = basePanY + dy;
                updateContainerTransform('dst');
            }
        });

        window.addEventListener('mouseup', function(e) {
            if (isPanning) {
                isPanning = false;
                vp.classList.remove('panning');
            }
        });

        vp.addEventListener('touchstart', function(e) {
            if (e.target.classList.contains('corner-handle')) return;
            if (e.touches.length === 1) {
                isPanning = true;
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                basePanX = (type === 'src' ? panSrc.x : panDst.x);
                basePanY = (type === 'src' ? panSrc.y : panDst.y);
            }
        }, { passive: true });

        window.addEventListener('touchmove', function(e) {
            if (!isPanning || e.touches.length !== 1) return;
            let dx = e.touches[0].clientX - startX;
            let dy = e.touches[0].clientY - startY;
            if (type === 'src') {
                panSrc.x = basePanX + dx;
                panSrc.y = basePanY + dy;
                updateContainerTransform('src');
            } else {
                panDst.x = basePanX + dx;
                panDst.y = basePanY + dy;
                updateContainerTransform('dst');
            }
        }, { passive: true });

        window.addEventListener('touchend', function() {
            isPanning = false;
        });
    });

    // ID Card Studio: Click on canvas-id-dst to select/highlight a specific slot
    let canvasIdDst = document.getElementById('canvas-id-dst');
    if (canvasIdDst) {
        canvasIdDst.addEventListener('click', function(e) {
            if (currentMode !== 'ID') return;
            let rect = canvasIdDst.getBoundingClientRect();
            let scaleX = canvasIdDst.width / rect.width;
            let scaleY = canvasIdDst.height / rect.height;
            let clickX = (e.clientX - rect.left) * scaleX;
            let clickY = (e.clientY - rect.top) * scaleY;

            if (idSlotGeometry.slot1 && clickY >= idSlotGeometry.slot1.y && clickY <= idSlotGeometry.slot1.y + idSlotGeometry.slot1.h) {
                activeSlot = 'left';
                drawIDPreviewComposite();
            } else if (idSlotGeometry.slot2 && clickY >= idSlotGeometry.slot2.y && clickY <= idSlotGeometry.slot2.y + idSlotGeometry.slot2.h) {
                activeSlot = 'right';
                drawIDPreviewComposite();
            }
        });
    }
}

window.addEventListener('DOMContentLoaded', initViewportPanAndZoom);

function whenOpenCvReady(callback) {
    if (typeof cv !== 'undefined' && cv.Mat) { 
        cvReady = true; 
        callback(); 
        return; 
    }
    setTimeout(() => whenOpenCvReady(callback), 120);
}

whenOpenCvReady(() => {
    console.log("OpenCV.js initialized successfully.");
});

let studioSessionToken = 0;

function scheduleLiveTransform(delay = 80) {
    if (activeIndex === -1) return;
    clearTimeout(transformTimer);
    const token = studioSessionToken;
    const mode = currentMode;
    transformTimer = setTimeout(() => {
        if (liveTransformFrame) return;
        liveTransformFrame = requestAnimationFrame(() => { 
            liveTransformFrame = null; 
            if (token !== studioSessionToken || mode !== currentMode) return;
            processImageTransform(); 
        });
    }, delay);
}

/**
 * Shared Database for ID Card Studio & Document Studio
 * Database A: Monu_DocIDStudio_DB
 * Stores both document studio and ID card studio images, settings, and slots
 * so users never have to repeatedly upload images when switching between them.
 */
window.DocIDStudioDB = {
    dbName: 'Monu_DocIDStudio_DB',
    version: 2,
    db: null,
    async init() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.dbName, this.version);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('projects')) {
                    db.createObjectStore('projects', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('idCardData')) {
                    db.createObjectStore('idCardData', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('documentData')) {
                    db.createObjectStore('documentData', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('sharedImages')) {
                    db.createObjectStore('sharedImages', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
            req.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },
    async put(storeName, value) {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                store.put(value);
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn(`DocIDStudioDB put error in ${storeName}:`, err);
            return false;
        }
    },
    async get(storeName, key) {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result ? req.result : null);
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn(`DocIDStudioDB get error in ${storeName}:`, err);
            return null;
        }
    },
    async delete(storeName, key) {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                store.delete(key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn(`DocIDStudioDB delete error in ${storeName}:`, err);
            return false;
        }
    },
    async getAll(storeName) {
        try {
            const db = await this.init();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (err) {
            console.warn(`DocIDStudioDB getAll error in ${storeName}:`, err);
            return [];
        }
    },
    async saveState(key, data) {
        return this.put('projects', { id: key, timestamp: Date.now(), data });
    },
    async getState(key) {
        const res = await this.get('projects', key);
        return res ? res.data : null;
    }
};

function serializeImageItem(imgObj) {
    if (!imgObj) return null;
    let dataUrl = '';
    if (imgObj.element && imgObj.element.src) {
        dataUrl = imgObj.element.src;
    }
    return {
        id: imgObj.id || (Date.now() + Math.random()),
        name: imgObj.name || 'document_page',
        dataUrl: dataUrl,
        rotation: imgObj.rotation || 0,
        corners: imgObj.corners ? JSON.parse(JSON.stringify(imgObj.corners)) : null,
        contrast: imgObj.contrast !== undefined ? imgObj.contrast : 1.0,
        brightness: imgObj.brightness !== undefined ? imgObj.brightness : 0,
        saturation: imgObj.saturation !== undefined ? imgObj.saturation : 1.0,
        sharpness: imgObj.sharpness !== undefined ? imgObj.sharpness : 0,
        shadowRemoval: !!imgObj.shadowRemoval,
        filterMode: imgObj.filterMode || 'GRAYSCALE'
    };
}

function deserializeImageItem(item) {
    return new Promise((resolve) => {
        if (!item || !item.dataUrl) return resolve(null);
        let img = new Image();
        img.onload = () => {
            resolve({
                id: item.id || (Date.now() + Math.random()),
                name: item.name || 'document_page',
                element: img,
                rotation: item.rotation || 0,
                corners: item.corners ? JSON.parse(JSON.stringify(item.corners)) : null,
                processedCanvas: null,
                contrast: item.contrast !== undefined ? item.contrast : 1.0,
                brightness: item.brightness !== undefined ? item.brightness : 0,
                saturation: item.saturation !== undefined ? item.saturation : 1.0,
                sharpness: item.sharpness !== undefined ? item.sharpness : 0,
                shadowRemoval: !!item.shadowRemoval,
                filterMode: item.filterMode || 'GRAYSCALE'
            });
        };
        img.onerror = () => {
            console.warn('Could not deserialize image from dataUrl:', item.name);
            resolve(null);
        };
        img.src = item.dataUrl;
    });
}

function createCanvasFromDataUrl(dataUrl) {
    if (!dataUrl) return Promise.resolve(null);
    return new Promise((resolve) => {
        let img = new Image();
        img.onload = () => {
            let c = document.createElement('canvas');
            c.width = img.naturalWidth || img.width;
            c.height = img.naturalHeight || img.height;
            let ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(c);
        };
        img.onerror = () => resolve(null);
        img.src = dataUrl;
    });
}

function cloneImageArray(sourceArr) {
    if (!Array.isArray(sourceArr)) return [];
    return sourceArr.map(item => ({
        id: item.id || (Date.now() + Math.random()),
        name: item.name,
        element: item.element,
        rotation: item.rotation || 0,
        corners: item.corners ? JSON.parse(JSON.stringify(item.corners)) : null,
        processedCanvas: null,
        contrast: item.contrast !== undefined ? item.contrast : 1.0,
        brightness: item.brightness !== undefined ? item.brightness : 0,
        saturation: item.saturation !== undefined ? item.saturation : 1.0,
        sharpness: item.sharpness !== undefined ? item.sharpness : 0,
        shadowRemoval: !!item.shadowRemoval,
        filterMode: item.filterMode || 'GRAYSCALE'
    }));
}

function updateDBSyncIndicator(synced, isSaving = false) {
    // DB sync indicator removed per user request
}

let studioDBSaveTimer = null;
function scheduleStudioDBSave(delay = 500) {
    clearTimeout(studioDBSaveTimer);
    updateDBSyncIndicator(false, true);
    studioDBSaveTimer = setTimeout(() => {
        saveStudioToDB(currentMode);
    }, delay);
}

async function saveStudioToDB(modeToSave) {
    const targetMode = modeToSave || currentMode;
    if (targetMode !== 'DOC' && targetMode !== 'ID') return;
    saveStudioState(targetMode);
    try {
        await window.DocIDStudioDB.init();
        const serializedImages = (imageArray || []).map(serializeImageItem).filter(Boolean);
        const docPayload = {
            id: 'session',
            images: serializedImages,
            activeIndex: activeIndex,
            corners: corners,
            filterMode: filterMode,
            shadowRemovalActive: shadowRemovalActive,
            contrast: docStudioState.contrast,
            brightness: docStudioState.brightness,
            saturation: docStudioState.saturation,
            sharpness: docStudioState.sharpness,
            rotation: docStudioState.rotation,
            zoomSrc: docStudioState.zoomSrc,
            panSrc: docStudioState.panSrc,
            zoomDst: docStudioState.zoomDst,
            panDst: docStudioState.panDst,
            updatedAt: Date.now()
        };
        await window.DocIDStudioDB.put('documentData', docPayload);

        const serializedBuckets = (idStudioState.bucketPairs || []).map(b => ({
            id: b.id,
            leftData: b.left ? b.left.toDataURL('image/png') : null,
            rightData: b.right ? b.right.toDataURL('image/png') : null
        }));
        const idPayload = {
            id: 'session',
            images: serializedImages,
            activeIndex: activeIndex,
            corners: corners,
            filterMode: filterMode,
            shadowRemovalActive: shadowRemovalActive,
            contrast: idStudioState.contrast,
            brightness: idStudioState.brightness,
            saturation: idStudioState.saturation,
            sharpness: idStudioState.sharpness,
            rotation: idStudioState.rotation,
            idLeftDataUrl: idStudioState.idLeftCanvas ? idStudioState.idLeftCanvas.toDataURL('image/png') : null,
            idRightDataUrl: idStudioState.idRightCanvas ? idStudioState.idRightCanvas.toDataURL('image/png') : null,
            activeSlot: idStudioState.activeSlot,
            idSlotGeometry: idStudioState.idSlotGeometry,
            bucketPairs: serializedBuckets,
            activeBucketIdx: idStudioState.activeBucketIdx,
            idOrientation: idStudioState.idOrientation,
            checkCropMarks: idStudioState.checkCropMarks,
            zoomSrc: idStudioState.zoomSrc,
            panSrc: idStudioState.panSrc,
            zoomDst: idStudioState.zoomDst,
            panDst: idStudioState.panDst,
            updatedAt: Date.now()
        };
        await window.DocIDStudioDB.put('idCardData', idPayload);
    } catch (err) {
        console.warn('saveStudioToDB error:', err);
    }
}

let dbLoaded = false;
async function loadStudioFromDB() {
    if (dbLoaded) return;
    try {
        await window.DocIDStudioDB.init();

        const docData = await window.DocIDStudioDB.get('documentData', 'session');
        const idData = await window.DocIDStudioDB.get('idCardData', 'session');

        let restoredImages = [];
        const sourceData = (docData && Array.isArray(docData.images) && docData.images.length > 0) ? docData : (idData && Array.isArray(idData.images) && idData.images.length > 0 ? idData : null);

        if (sourceData && Array.isArray(sourceData.images)) {
            for (const item of sourceData.images) {
                const imgObj = await deserializeImageItem(item);
                if (imgObj) restoredImages.push(imgObj);
            }
        }
        if (restoredImages.length > 0) {
            imageArray = restoredImages;
            activeIndex = Math.min(Math.max(0, sourceData.activeIndex !== undefined ? sourceData.activeIndex : 0), restoredImages.length - 1);
            if (sourceData.corners) corners = sourceData.corners;
            if (sourceData.filterMode) filterMode = sourceData.filterMode;
            shadowRemovalActive = !!sourceData.shadowRemovalActive;
        }

        if (idData) {
            if (idData.idLeftDataUrl) {
                idStudioState.idLeftCanvas = await createCanvasFromDataUrl(idData.idLeftDataUrl);
                idLeftCanvas = idStudioState.idLeftCanvas;
            }
            if (idData.idRightDataUrl) {
                idStudioState.idRightCanvas = await createCanvasFromDataUrl(idData.idRightDataUrl);
                idRightCanvas = idStudioState.idRightCanvas;
            }
            if (Array.isArray(idData.bucketPairs) && idData.bucketPairs.length > 0) {
                const restoredBuckets = [];
                for (const b of idData.bucketPairs) {
                    const lCanvas = await createCanvasFromDataUrl(b.leftData);
                    const rCanvas = await createCanvasFromDataUrl(b.rightData);
                    restoredBuckets.push({ id: b.id, left: lCanvas, right: rCanvas });
                }
                idStudioState.bucketPairs = restoredBuckets;
                bucketPairs = idStudioState.bucketPairs;
                activeBucketIdx = idData.activeBucketIdx !== undefined ? idData.activeBucketIdx : -1;
            }
        }

        dbLoaded = true;

        // Hydrate incoming image sent from standalone Image & PDF Editor page
        try {
            if (sessionStorage.getItem('monu_pending_doc_transfer') === '1' && window.ImagePDFEditorDB) {
                sessionStorage.removeItem('monu_pending_doc_transfer');
                const incoming = await window.ImagePDFEditorDB.getEditorData('pending_doc_studio_transfer');
                if (incoming && incoming.dataUrl) {
                    await window.ImagePDFEditorDB.saveEditorData('pending_doc_studio_transfer', null);
                    const importedImg = await new Promise((res, rej) => {
                        const im = new Image();
                        im.onload = () => res(im);
                        im.onerror = rej;
                        im.src = incoming.dataUrl;
                    });
                    if (activeIndex !== -1 && imageArray[activeIndex]) {
                        const activeObj = imageArray[activeIndex];
                        activeObj.element = importedImg;
                        activeObj.rotation = 0;
                        activeObj.corners = null;
                        activeObj.cornersDisplayDim = null;
                        activeObj.processedCanvas = null;
                    } else {
                        imageArray.push({
                            id: Date.now() + Math.random(),
                            name: incoming.name || 'edited_document.png',
                            element: importedImg,
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
                        activeIndex = imageArray.length - 1;
                    }
                    corners = null;
                    if (typeof docStudioState !== 'undefined') {
                        docStudioState.activeIndex = activeIndex;
                        docStudioState.corners = null;
                    }
                    saveStudioToDB('DOC');
                }
            }
        } catch (transferErr) {
            console.warn('Pending Doc Studio transfer restore warning:', transferErr);
        }

        if (currentMode === 'DOC') {
            rebuildGalleryStrip();
            updateButtonStates();
            const canvasSrc = document.getElementById('canvas-src');
            const containerSrc = document.getElementById('container-src');
            const srcEmptyMsg = document.getElementById('src-empty-msg');
            const canvasDst = document.getElementById('canvas-dst');
            const docDstEmptyMsg = document.getElementById('doc-dst-empty-msg');

            if (imageArray.length > 0 && activeIndex !== -1 && imageArray[activeIndex]) {
                if (canvasSrc) canvasSrc.style.display = 'block';
                if (containerSrc) containerSrc.style.display = 'inline-block';
                if (srcEmptyMsg) srcEmptyMsg.style.display = 'none';
                if (canvasDst) canvasDst.style.display = 'block';
                if (docDstEmptyMsg) docDstEmptyMsg.style.display = 'none';
                setActiveImage(activeIndex);
            }
        } else if (currentMode === 'ID') {
            rebuildGalleryStrip();
            rebuildBucketDOM();
            updateButtonStates();
            drawIDPreviewComposite();

            const canvasSrc = document.getElementById('canvas-src');
            const containerSrc = document.getElementById('container-src');
            const srcEmptyMsg = document.getElementById('src-empty-msg');

            if (imageArray.length > 0 && activeIndex !== -1 && imageArray[activeIndex]) {
                if (canvasSrc) canvasSrc.style.display = 'block';
                if (containerSrc) containerSrc.style.display = 'inline-block';
                if (srcEmptyMsg) srcEmptyMsg.style.display = 'none';
                setActiveImage(activeIndex);
            }
        }
    } catch (err) {
        console.warn('loadStudioFromDB error:', err);
    }
}

function importImagesFromOtherStudio() {
    const otherMode = currentMode === 'ID' ? 'DOC' : 'ID';
    const sourceArr = otherMode === 'DOC' ? (docStudioState.imageArray || []) : (idStudioState.imageArray || []);
    if (!sourceArr || sourceArr.length === 0) return;

    let addedCount = 0;
    sourceArr.forEach(srcItem => {
        const alreadyExists = imageArray.some(img => img.id === srcItem.id || (img.name === srcItem.name && img.element && srcItem.element && img.element.src === srcItem.element.src));
        if (!alreadyExists) {
            imageArray.push({
                ...srcItem,
                id: Date.now() + Math.random(),
                corners: srcItem.corners ? JSON.parse(JSON.stringify(srcItem.corners)) : null,
                processedCanvas: null
            });
            addedCount++;
        }
    });

    if (addedCount > 0) {
        if (activeIndex === -1 && imageArray.length > 0) {
            setActiveImage(0);
        } else {
            rebuildGalleryStrip();
        }
        updateButtonStates();
        saveStudioToDB(currentMode);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    loadStudioFromDB();
});

// Studio State Isolation
const docStudioState = {
    activeIndex: -1,
    corners: null,
    tempCurrentCroppedCanvas: null,
    filterMode: 'GRAYSCALE',
    shadowRemovalActive: false,
    contrast: 1.6,
    brightness: -135,
    saturation: 1.0,
    sharpness: 0.0,
    rotation: 0,
    zoomSrc: 1.0,
    panSrc: { x: 0, y: 0 },
    zoomDst: 1.0,
    panDst: { x: 0, y: 0 }
};

const idStudioState = {
    activeIndex: -1,
    corners: null,
    tempCurrentCroppedCanvas: null,
    filterMode: 'GRAYSCALE',
    shadowRemovalActive: false,
    contrast: 1.6,
    brightness: -135,
    saturation: 1.0,
    sharpness: 0.0,
    rotation: 0,
    idLeftCanvas: null,
    idRightCanvas: null,
    activeSlot: null,
    idSlotGeometry: { slot1: null, slot2: null },
    bucketPairs: [],
    activeBucketIdx: -1,
    idOrientation: 'H',
    checkCropMarks: true,
    zoomSrc: 1.0,
    panSrc: { x: 0, y: 0 },
    zoomDst: 1.0,
    panDst: { x: 0, y: 0 }
};

function saveStudioState(mode) {
    saveCurrentActiveImageState();
    const sc = document.getElementById('slider-contrast');
    const sb = document.getElementById('slider-brightness');
    const ss = document.getElementById('slider-saturation');
    const sh = document.getElementById('slider-sharpness');
    const rot = document.getElementById('control-rotation');

    let canvasSrc = document.getElementById('canvas-src');
    let displayW = canvasSrc ? (parseFloat(canvasSrc.style.width) || canvasSrc.width) : 0;
    let displayH = canvasSrc ? (parseFloat(canvasSrc.style.height) || canvasSrc.height) : 0;
    let normalizedCorners = null;
    if (displayW > 0 && displayH > 0 && corners && isValidCornerQuad(corners)) {
        normalizedCorners = {
            tl: { x: corners.tl.x / displayW, y: corners.tl.y / displayH },
            tr: { x: corners.tr.x / displayW, y: corners.tr.y / displayH },
            br: { x: corners.br.x / displayW, y: corners.br.y / displayH },
            bl: { x: corners.bl.x / displayW, y: corners.bl.y / displayH }
        };
    } else if (corners && isValidCornerQuad(corners)) {
        normalizedCorners = JSON.parse(JSON.stringify(corners));
    }

    if (mode === 'DOC') {
        docStudioState.activeIndex = activeIndex;
        docStudioState.corners = normalizedCorners;
        docStudioState.tempCurrentCroppedCanvas = tempCurrentCroppedCanvas;
        docStudioState.filterMode = filterMode;
        docStudioState.shadowRemovalActive = shadowRemovalActive;
        docStudioState.contrast = sc ? parseFloat(sc.value) : 1.6;
        docStudioState.brightness = sb ? parseInt(sb.value, 10) : -135;
        docStudioState.saturation = ss ? parseFloat(ss.value) : 1.0;
        docStudioState.sharpness = sh ? parseFloat(sh.value) : 0.0;
        docStudioState.rotation = rot ? parseInt(rot.value, 10) : 0;
        docStudioState.zoomSrc = zoomSrc;
        docStudioState.panSrc = { ...panSrc };
        docStudioState.zoomDst = zoomDst;
        docStudioState.panDst = { ...panDst };
    } else if (mode === 'ID') {
        idStudioState.activeIndex = activeIndex;
        idStudioState.corners = normalizedCorners;
        idStudioState.tempCurrentCroppedCanvas = tempCurrentCroppedCanvas;
        idStudioState.filterMode = filterMode;
        idStudioState.shadowRemovalActive = shadowRemovalActive;
        idStudioState.contrast = sc ? parseFloat(sc.value) : 1.6;
        idStudioState.brightness = sb ? parseInt(sb.value, 10) : -135;
        idStudioState.saturation = ss ? parseFloat(ss.value) : 1.0;
        idStudioState.sharpness = sh ? parseFloat(sh.value) : 0.0;
        idStudioState.rotation = rot ? parseInt(rot.value, 10) : 0;
        idStudioState.idLeftCanvas = idLeftCanvas;
        idStudioState.idRightCanvas = idRightCanvas;
        idStudioState.activeSlot = activeSlot;
        idStudioState.idSlotGeometry = JSON.parse(JSON.stringify(idSlotGeometry));
        idStudioState.bucketPairs = bucketPairs;
        idStudioState.activeBucketIdx = activeBucketIdx;
        const orientEl = document.getElementById('control-id-orientation');
        if (orientEl) idStudioState.idOrientation = orientEl.value;
        const cmEl = document.getElementById('check-crop-marks');
        if (cmEl) idStudioState.checkCropMarks = cmEl.checked;
        idStudioState.zoomSrc = zoomSrc;
        idStudioState.panSrc = { ...panSrc };
        idStudioState.zoomDst = zoomDst;
        idStudioState.panDst = { ...panDst };
    }
}

function clearStudioCanvases() {
    ['canvas-src', 'canvas-dst', 'canvas-id-dst', 'canvas-hidden'].forEach(id => {
        const c = document.getElementById(id);
        if (c) {
            const ctx = c.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, c.width, c.height);
            c.width = 1;
            c.height = 1;
            c.style.width = '0px';
            c.style.height = '0px';
        }
    });
    ['tl', 'tr', 'br', 'bl'].forEach(pt => {
        const el = document.getElementById('pt-' + pt);
        if (el) el.style.display = 'none';
    });
    const polygon = document.getElementById('crop-polygon');
    if (polygon) polygon.setAttribute('points', '');
}

function cleanupModuleResources(fromMode, toMode) {
    studioSessionToken++;
    if (liveTransformFrame) {
        cancelAnimationFrame(liveTransformFrame);
        liveTransformFrame = null;
    }
    if (transformTimer) {
        clearTimeout(transformTimer);
        transformTimer = null;
    }

    if (tempCurrentCroppedCanvas) {
        let ctx = tempCurrentCroppedCanvas.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, tempCurrentCroppedCanvas.width, tempCurrentCroppedCanvas.height);
        tempCurrentCroppedCanvas.width = 1;
        tempCurrentCroppedCanvas.height = 1;
        tempCurrentCroppedCanvas = null;
    }

    if (fromMode === 'EDITOR') {
        if (typeof HISTORY !== 'undefined' && Array.isArray(HISTORY) && HISTORY.length > 10) {
            HISTORY = HISTORY.slice(HISTORY.length - 10);
            if (typeof updateURBtns === 'function') updateURBtns();
        }
    }
}

function switchMode(mode) {
    if (currentMode === mode) return;

    const previousMode = currentMode;
    if (previousMode === 'DOC' || previousMode === 'ID') {
        saveStudioState(previousMode);
        saveStudioToDB(previousMode);
    }
    cleanupModuleResources(previousMode, mode);
    currentMode = mode;

    const tabDoc = document.getElementById('tab-doc');
    const tabId = document.getElementById('tab-id');
    const tabEditor = document.getElementById('tab-editor');
    const enhancerWs = document.getElementById('enhancer-main-workspace');
    const editorWs = document.getElementById('editor-main-workspace');

    if (mode === 'DOC') {
        if (tabDoc) tabDoc.className = 'mode-tab active'; 
        if (tabId) tabId.className = 'mode-tab';
        if (tabEditor) tabEditor.className = 'mode-tab';
        if (enhancerWs) {
            enhancerWs.style.display = 'grid';
            enhancerWs.classList.remove('id-mode');
        }
        if (editorWs) editorWs.style.display = 'none';

        document.getElementById('side-selector-container').style.display = 'none'; 
        document.getElementById('export-doc-section').style.display = 'block';
        document.getElementById('export-id-section').style.display = 'none'; 
        document.getElementById('btn-save-bucket').style.display = 'none';
        document.getElementById('btn-optimize-all').style.display = 'block';
        document.getElementById('id-bucket-container').style.display = 'none'; 
        document.getElementById('screen2-title').innerText = "Live Filter Output Render";
        document.getElementById('group-id-orientation').style.display = 'none';
        document.getElementById('badge-src-dim').innerText = "A4 / Source View";
        document.getElementById('badge-dst-dim').innerText = "Scanned Output View";

        // Isolation: Hide ID Card Studio container and show Document Studio container
        const containerDocDst = document.getElementById('container-dst');
        const containerIdDst = document.getElementById('container-id-dst');
        if (containerIdDst) containerIdDst.style.display = 'none';
        if (containerDocDst) containerDocDst.style.display = 'inline-block';

        // Restore Document Studio state
        if (docStudioState.activeIndex !== undefined && docStudioState.activeIndex !== -1) {
            activeIndex = docStudioState.activeIndex;
        }
        corners = (docStudioState.corners && isValidCornerQuad(docStudioState.corners)) ? JSON.parse(JSON.stringify(docStudioState.corners)) : null;
        tempCurrentCroppedCanvas = docStudioState.tempCurrentCroppedCanvas;
        filterMode = docStudioState.filterMode;
        shadowRemovalActive = docStudioState.shadowRemovalActive;
        zoomSrc = docStudioState.zoomSrc;
        panSrc = { ...docStudioState.panSrc };
        zoomDst = docStudioState.zoomDst;
        panDst = { ...docStudioState.panDst };
        updateContainerTransform('src');
        updateContainerTransform('dst');

        // Restore sliders
        const sc = document.getElementById('slider-contrast');
        const sb = document.getElementById('slider-brightness');
        const ss = document.getElementById('slider-saturation');
        const sh = document.getElementById('slider-sharpness');
        const rot = document.getElementById('control-rotation');
        if (sc) sc.value = docStudioState.contrast;
        if (sb) sb.value = docStudioState.brightness;
        if (ss) ss.value = docStudioState.saturation;
        if (sh) sh.value = docStudioState.sharpness;
        if (rot) rot.value = docStudioState.rotation;

        const btnSr = document.getElementById('btn-shadow-removal');
        if (btnSr) {
            btnSr.innerText = `Shadow Remov: ${shadowRemovalActive ? 'ON' : 'OFF'}`;
            btnSr.classList.toggle('active', shadowRemovalActive);
        }
        setFilterMode(filterMode);
        updateSlidersLive();

        // Clear canvases to isolate and prevent stale preview leak
        clearStudioCanvases();

        rebuildGalleryStrip();
        updateButtonStates();

        const canvasSrc = document.getElementById('canvas-src');
        const containerSrc = document.getElementById('container-src');
        const srcEmptyMsg = document.getElementById('src-empty-msg');
        const canvasDst = document.getElementById('canvas-dst');
        const docDstEmptyMsg = document.getElementById('doc-dst-empty-msg');

        if (imageArray.length > 0 && activeIndex !== -1 && imageArray[activeIndex]) {
            if (canvasSrc) canvasSrc.style.display = 'block';
            if (containerSrc) containerSrc.style.display = 'inline-block';
            if (srcEmptyMsg) srcEmptyMsg.style.display = 'none';
            if (canvasDst) canvasDst.style.display = 'block';
            if (docDstEmptyMsg) docDstEmptyMsg.style.display = 'none';
            setActiveImage(activeIndex);
        } else {
            // Document Studio empty state: strictly clean, no card slot, no card canvas, no card preview
            activeIndex = -1;
            if (canvasSrc) canvasSrc.style.display = 'none';
            if (containerSrc) containerSrc.style.display = 'none';
            if (srcEmptyMsg) {
                srcEmptyMsg.style.display = 'flex';
                const st = document.getElementById('src-empty-title');
                const sd = document.getElementById('src-empty-desc');
                if (st) st.innerText = "No Document Loaded";
                if (sd) sd.innerText = "Click 'Click or Drop Files' in the sidebar to upload.";
            }
            if (canvasDst) {
                canvasDst.style.display = 'none';
                let ctx = canvasDst.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, canvasDst.width, canvasDst.height);
                canvasDst.width = 1;
                canvasDst.height = 1;
            }
            if (docDstEmptyMsg) docDstEmptyMsg.style.display = 'flex';
            document.getElementById('badge-src-dim').innerText = "A4 / Source View";
            document.getElementById('badge-dst-dim').innerText = "Scanned Output View";
            document.getElementById('screen2-title').innerText = "Live Filter Output Render";
        }
        saveStudioToDB('DOC');
    } else if (mode === 'ID') {
        if (tabDoc) tabDoc.className = 'mode-tab'; 
        if (tabId) tabId.className = 'mode-tab active';
        if (tabEditor) tabEditor.className = 'mode-tab';
        if (enhancerWs) {
            enhancerWs.style.display = 'grid';
            enhancerWs.classList.add('id-mode');
        }
        if (editorWs) editorWs.style.display = 'none';

        document.getElementById('side-selector-container').style.display = 'grid'; 
        document.getElementById('export-doc-section').style.display = 'none';
        document.getElementById('export-id-section').style.display = 'block'; 
        document.getElementById('btn-save-bucket').style.display = 'block';
        document.getElementById('btn-optimize-all').style.display = 'none';
        document.getElementById('id-bucket-container').style.display = 'flex'; 
        document.getElementById('screen2-title').innerText = "ID Slots Preview";
        document.getElementById('group-id-orientation').style.display = 'block';
        document.getElementById('badge-src-dim').innerText = "Source Card View";
        document.getElementById('badge-dst-dim').innerText = "ISO CR80 Slot Preview";

        // Isolation: Hide Document Studio container and show ID Card Studio container
        const containerDocDst = document.getElementById('container-dst');
        const containerIdDst = document.getElementById('container-id-dst');
        if (containerDocDst) containerDocDst.style.display = 'none';
        if (containerIdDst) containerIdDst.style.display = 'inline-block';

        // Restore ID Card Studio state
        if (idStudioState.activeIndex !== undefined && idStudioState.activeIndex !== -1) {
            activeIndex = idStudioState.activeIndex;
        }
        corners = (idStudioState.corners && isValidCornerQuad(idStudioState.corners)) ? JSON.parse(JSON.stringify(idStudioState.corners)) : null;
        tempCurrentCroppedCanvas = idStudioState.tempCurrentCroppedCanvas;
        filterMode = idStudioState.filterMode;
        shadowRemovalActive = idStudioState.shadowRemovalActive;
        idLeftCanvas = idStudioState.idLeftCanvas;
        idRightCanvas = idStudioState.idRightCanvas;
        activeSlot = idStudioState.activeSlot;
        idSlotGeometry = JSON.parse(JSON.stringify(idStudioState.idSlotGeometry));
        bucketPairs = idStudioState.bucketPairs;
        activeBucketIdx = idStudioState.activeBucketIdx;
        zoomSrc = idStudioState.zoomSrc;
        panSrc = { ...idStudioState.panSrc };
        zoomDst = idStudioState.zoomDst;
        panDst = { ...idStudioState.panDst };
        updateContainerTransform('src');
        updateContainerTransform('dst');

        const sc = document.getElementById('slider-contrast');
        const sb = document.getElementById('slider-brightness');
        const ss = document.getElementById('slider-saturation');
        const sh = document.getElementById('slider-sharpness');
        const rot = document.getElementById('control-rotation');
        if (sc) sc.value = idStudioState.contrast;
        if (sb) sb.value = idStudioState.brightness;
        if (ss) ss.value = idStudioState.saturation;
        if (sh) sh.value = idStudioState.sharpness;
        if (rot) rot.value = idStudioState.rotation;

        const orientEl = document.getElementById('control-id-orientation');
        if (orientEl) orientEl.value = idStudioState.idOrientation || 'H';
        const cmEl = document.getElementById('check-crop-marks');
        if (cmEl) cmEl.checked = idStudioState.checkCropMarks !== false;

        const btnSr = document.getElementById('btn-shadow-removal');
        if (btnSr) {
            btnSr.innerText = `Shadow Remov: ${shadowRemovalActive ? 'ON' : 'OFF'}`;
            btnSr.classList.toggle('active', shadowRemovalActive);
        }
        setFilterMode(filterMode);
        updateSlidersLive();

        clearStudioCanvases();
        rebuildGalleryStrip();
        rebuildBucketDOM();
        updateButtonStates();

        const canvasSrc = document.getElementById('canvas-src');
        const containerSrc = document.getElementById('container-src');
        const srcEmptyMsg = document.getElementById('src-empty-msg');

        if (!activeSlot) {
            if (!idLeftCanvas) activeSlot = 'left';
            else if (!idRightCanvas) activeSlot = 'right';
            else activeSlot = 'left';
        }

        if (imageArray.length > 0 && activeIndex !== -1 && imageArray[activeIndex]) {
            if (canvasSrc) canvasSrc.style.display = 'block';
            if (containerSrc) containerSrc.style.display = 'inline-block';
            if (srcEmptyMsg) srcEmptyMsg.style.display = 'none';
            setActiveImage(activeIndex);
        } else {
            activeIndex = -1;
            if (canvasSrc) canvasSrc.style.display = 'none';
            if (containerSrc) containerSrc.style.display = 'none';
            if (srcEmptyMsg) {
                srcEmptyMsg.style.display = 'flex';
                const st = document.getElementById('src-empty-title');
                const sd = document.getElementById('src-empty-desc');
                if (st) st.innerText = "No Card Loaded";
                if (sd) sd.innerText = "Click 'Click or Drop Files' to load an ID card image.";
            }
            drawIDPreviewComposite();
        }
        saveStudioToDB('ID');
    } else if (mode === 'EDITOR') {
        if (tabDoc) tabDoc.className = 'mode-tab'; 
        if (tabId) tabId.className = 'mode-tab';
        if (tabEditor) tabEditor.className = 'mode-tab active';
        if (enhancerWs) enhancerWs.style.display = 'none';
        if (editorWs) editorWs.style.display = 'flex';
    }
}

function getOrGenerateCroppedCanvas() {
    if (tempCurrentCroppedCanvas) return tempCurrentCroppedCanvas;

    if (activeIndex === -1 && imageArray.length > 0) {
        setActiveImage(0);
    }

    if (activeIndex !== -1 && imageArray[activeIndex]) {
        try {
            processImageTransform();
        } catch (e) {
            console.warn("processImageTransform catch in getOrGenerateCroppedCanvas:", e);
        }
        if (tempCurrentCroppedCanvas) return tempCurrentCroppedCanvas;

        let imgObj = imageArray[activeIndex];
        if (imgObj && imgObj.element) {
            tempCurrentCroppedCanvas = renderRotatedOriginalToCanvas(imgObj);
            return tempCurrentCroppedCanvas;
        }
    }
    return null;
}

function assignCroppedToSide(side) {
    if (activeIndex === -1 && imageArray.length > 0) {
        setActiveImage(0);
    }
    let croppedCanvas = getOrGenerateCroppedCanvas();
    if (!croppedCanvas && imageArray.length > 0) {
        setActiveImage(activeIndex >= 0 ? activeIndex : 0);
        croppedCanvas = getOrGenerateCroppedCanvas();
    }
    if (!croppedCanvas) { 
        alert("Please upload or select an image first!"); 
        return; 
    }
    let targetHolder = document.createElement('canvas'); 
    targetHolder.width = croppedCanvas.width; 
    targetHolder.height = croppedCanvas.height;
    targetHolder.getContext('2d').drawImage(croppedCanvas, 0, 0);
    
    let btn = document.getElementById(side === 'left' ? 'btn-assign-left' : 'btn-assign-right');
    if (side === 'left') { 
        idLeftCanvas = targetHolder; 
        if (!idRightCanvas) {
            activeSlot = 'right'; // Auto-advance to Slot 2
        } else {
            activeSlot = 'left';
        }
        if (btn) {
            btn.style.borderColor = '#1fd1f9'; 
            setTimeout(() => { btn.style.borderColor = ''; }, 600); 
        }
    } else { 
        idRightCanvas = targetHolder; 
        if (!idLeftCanvas) {
            activeSlot = 'left'; // Auto-advance to Slot 1
        } else {
            activeSlot = 'right';
        }
        if (btn) {
            btn.style.borderColor = '#b621fe'; 
            setTimeout(() => { btn.style.borderColor = ''; }, 600); 
        }
    }
    let s2 = document.getElementById('screen2-title');
    if (s2) s2.innerText = "ID Slots Preview"; 
    drawIDPreviewComposite();
    saveStudioToDB('ID');
}

document.getElementById('file-input').addEventListener('change', async function(e) {
    if(e.target.files.length === 0) return;
    let files = Array.from(e.target.files); 
    let filesProcessed = 0; 
    let originalLength = imageArray.length;
    
    for (let file of files) {
        if (file.type === "application/pdf") { 
            await processPdfFile(file); 
            filesProcessed++; 
        } else {
            await new Promise((resolve) => {
                let reader = new FileReader();
                reader.onload = function(event) {
                    let img = new Image();
                    img.onload = function() { 
                        imageArray.push({ 
                            id: Date.now() + Math.random(), 
                            name: file.name, 
                            element: img, 
                            rotation: 0, 
                            corners: null, 
                            processedCanvas: null,
                            contrast: 1.0,
                            brightness: 0,
                            saturation: 1.0,
                            sharpness: 0,
                            shadowRemoval: false,
                            filterMode: 'GRAYSCALE'
                        }); 
                        resolve(); 
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
            filesProcessed++;
        }
        if(filesProcessed === files.length) { 
            rebuildGalleryStrip(); 
            if(activeIndex === -1 && imageArray.length > 0) {
                setActiveImage(0);
            }
            updateButtonStates(); 
            saveStudioToDB(currentMode);
        }
    }
});

async function processPdfFile(file) {
    return new Promise((resolve) => {
        let reader = new FileReader();
        reader.onload = async function(e) {
            try {
                let typedarray = new Uint8Array(e.target.result);
                let attempts = 0;
                let loadingTask = pdfjsLib.getDocument({
                    data: typedarray,
                    onPassword: (updatePassword, reason) => {
                        attempts++;
                        if (attempts > 3) {
                            updatePassword(new Error('Password attempts exceeded'));
                            return;
                        }
                        let pwd = null;
                        try {
                            const promptText = reason === 1
                                ? `🔒 "${file.name}" is password protected.\nPlease enter the PDF Password:`
                                : `❌ Incorrect password for "${file.name}".\nPlease enter the correct password:`;
                            pwd = window.prompt(promptText);
                        } catch (err) {
                            console.warn('window.prompt unavailable:', err);
                        }
                        if (pwd !== null && pwd !== '') {
                            updatePassword(pwd);
                        } else {
                            updatePassword(new Error('Password entry cancelled'));
                        }
                    }
                });
                let pdf = await loadingTask.promise;
                for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                    let page = await pdf.getPage(pageNum); 
                    let viewport = page.getViewport({scale: 2.0});
                    let canvas = document.createElement('canvas'); 
                    canvas.width = viewport.width; 
                    canvas.height = viewport.height;
                    await page.render({canvasContext: canvas.getContext('2d'), viewport: viewport}).promise;
                    
                    let img = new Image();
                    await new Promise((imgResolve) => {
                        img.onload = () => { 
                            imageArray.push({ 
                                id: Date.now() + Math.random(), 
                                name: `${file.name}_p${pageNum}`, 
                                element: img, 
                                rotation: 0, 
                                corners: null, 
                                processedCanvas: null,
                                contrast: 1.0,
                                brightness: 0,
                                saturation: 1.0,
                                sharpness: 0,
                                shadowRemoval: false,
                                filterMode: 'GRAYSCALE'
                            }); 
                            imgResolve(); 
                        };
                        img.src = canvas.toDataURL('image/jpeg', 0.95);
                    });
                }
            } catch (err) { 
                console.error("PDF Processing Error:", err); 
            }
            resolve();
        };
        reader.readAsArrayBuffer(file);
    });
}

function rebuildGalleryStrip() {
    let strip = document.getElementById('gallery-strip'); 
    if (!strip) return;
    strip.innerHTML = '';
    let countEl = document.getElementById('gallery-count');
    if (countEl) countEl.innerText = `${imageArray.length} IMG`;

    if (imageArray.length === 0) { 
        let emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px 8px;';
        emptyDiv.innerText = 'No files loaded.';
        strip.appendChild(emptyDiv);
        return; 
    }
    imageArray.forEach((imgObj, idx) => {
        let box = document.createElement('div'); 
        box.className = `thumb-box ${idx === activeIndex ? 'active' : ''}`; 
        box.onclick = () => setActiveImage(idx);
        
        let imgEl = document.createElement('img'); 
        imgEl.src = imgObj.element.src;
        
        let deleteBtn = document.createElement('button'); 
        deleteBtn.className = 'thumb-delete'; 
        deleteBtn.innerHTML = '&times;';
        deleteBtn.onclick = (e) => { 
            e.stopPropagation(); 
            deleteImage(idx); 
        };
        
        box.appendChild(deleteBtn); 
        box.appendChild(imgEl); 
        strip.appendChild(box);
    });
}

function deleteImage(idx) {
    imageArray.splice(idx, 1);
    if (imageArray.length === 0) {
        activeIndex = -1; 
        tempCurrentCroppedCanvas = null;
        let cSrc = document.getElementById('canvas-src');
        let cDst = document.getElementById('canvas-dst');
        let cIdDst = document.getElementById('canvas-id-dst');
        let cHidden = document.getElementById('canvas-hidden');
        if (cSrc) {
            let ctx = cSrc.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, cSrc.width, cSrc.height);
            cSrc.width = 1; cSrc.height = 1;
            cSrc.style.width = '0px'; cSrc.style.height = '0px';
            cSrc.style.display = 'none';
        }
        let containerSrc = document.getElementById('container-src');
        if (containerSrc) containerSrc.style.display = 'none';
        let srcEmptyMsg = document.getElementById('src-empty-msg');
        if (srcEmptyMsg) srcEmptyMsg.style.display = 'flex';

        if (currentMode === 'DOC') {
            if (cDst) {
                let ctx = cDst.getContext('2d');
                if (ctx) ctx.clearRect(0, 0, cDst.width, cDst.height);
                cDst.width = 1; cDst.height = 1;
                cDst.style.width = '0px'; cDst.style.height = '0px';
                cDst.style.display = 'none';
            }
            let docDstEmptyMsg = document.getElementById('doc-dst-empty-msg');
            if (docDstEmptyMsg) docDstEmptyMsg.style.display = 'flex';
            let badgeSrc = document.getElementById('badge-src-dim');
            if (badgeSrc) badgeSrc.innerText = "A4 / Source View";
            let badgeDst = document.getElementById('badge-dst-dim');
            if (badgeDst) badgeDst.innerText = "Scanned Output View";
        } else if (currentMode === 'ID') {
            drawIDPreviewComposite();
        }

        if (cHidden) {
            let ctx = cHidden.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, cHidden.width, cHidden.height);
            cHidden.width = 1; cHidden.height = 1;
        }
        ['tl', 'tr', 'br', 'bl'].forEach(pt => {
            let el = document.getElementById('pt-' + pt);
            if (el) el.style.display = 'none';
        });
        let polygon = document.getElementById('crop-polygon');
        if (polygon) polygon.setAttribute('points', '');
    } else { 
        if (activeIndex >= imageArray.length) activeIndex = imageArray.length - 1; 
        setActiveImage(activeIndex); 
    }
    rebuildGalleryStrip(); 
    updateButtonStates();
    saveStudioToDB(currentMode);
}

function updateButtonStates() {
    let disabled = imageArray.length === 0;
    ['btn-optimize-all', 'btn-effect-threshold', 'btn-effect-grayscale', 'btn-effect-color', 'btn-effect-enhance', 'btn-shadow-removal', 'btn-save-img', 'btn-save-pdf', 'btn-save-bucket', 'btn-print-doc', 'btn-doc-send-to'].forEach(id => {
        let el = document.getElementById(id);
        if (el) el.disabled = disabled;
    });
}

function renderRotatedOriginalToCanvas(imgObj) {
    let tempCanvas = document.createElement('canvas'); 
    let tempCtx = tempCanvas.getContext('2d'); 
    let img = imgObj.element;
    if (imgObj.rotation === 90 || imgObj.rotation === 270) { 
        tempCanvas.width = img.height; 
        tempCanvas.height = img.width; 
    } else { 
        tempCanvas.width = img.width; 
        tempCanvas.height = img.height; 
    }
    tempCtx.translate(tempCanvas.width / 2, tempCanvas.height / 2); 
    tempCtx.rotate((imgObj.rotation * Math.PI) / 180); 
    tempCtx.drawImage(img, -img.width / 2, -img.height / 2);
    return tempCanvas;
}

function saveCurrentActiveImageState() {
    if (activeIndex !== -1 && imageArray[activeIndex]) {
        let curr = imageArray[activeIndex];
        let sc = document.getElementById('slider-contrast');
        let sb = document.getElementById('slider-brightness');
        let ss = document.getElementById('slider-saturation');
        let sh = document.getElementById('slider-sharpness');
        if (sc) curr.contrast = parseFloat(sc.value);
        if (sb) curr.brightness = parseInt(sb.value, 10);
        if (ss) curr.saturation = parseFloat(ss.value);
        if (sh) curr.sharpness = parseFloat(sh.value);
        curr.shadowRemoval = shadowRemovalActive;
        curr.filterMode = filterMode;
        let rot = document.getElementById('control-rotation');
        if (rot) curr.rotation = parseInt(rot.value, 10);
        
        let canvasSrc = document.getElementById('canvas-src');
        if (canvasSrc && corners && isValidCornerQuad(corners)) {
            let displayW = parseFloat(canvasSrc.style.width) || canvasSrc.width;
            let displayH = parseFloat(canvasSrc.style.height) || canvasSrc.height;
            if (displayW > 10 && displayH > 10) {
                curr.corners = {
                    tl: { x: corners.tl.x / displayW, y: corners.tl.y / displayH },
                    tr: { x: corners.tr.x / displayW, y: corners.tr.y / displayH },
                    br: { x: corners.br.x / displayW, y: corners.br.y / displayH },
                    bl: { x: corners.bl.x / displayW, y: corners.bl.y / displayH }
                };
                curr.cornersDisplayDim = { w: displayW, h: displayH };
            }
        }
    }
}

function setActiveImage(idx) {
    if(idx < 0 || idx >= imageArray.length) return;
    if (activeIndex !== idx && activeIndex >= 0 && activeIndex < imageArray.length) {
        saveCurrentActiveImageState();
    }
    activeIndex = idx; 
    let imgObj = imageArray[activeIndex]; 
    rebuildGalleryStrip();
    
    let rotatedBase = renderRotatedOriginalToCanvas(imgObj);
    let hiddenCanvas = document.getElementById('canvas-hidden'); 
    hiddenCanvas.width = rotatedBase.width; 
    hiddenCanvas.height = rotatedBase.height;
    hiddenCanvas.getContext('2d').drawImage(rotatedBase, 0, 0);
    
    let canvasSrc = document.getElementById('canvas-src'); 
    if (canvasSrc) canvasSrc.style.display = 'block';
    let containerSrc = document.getElementById('container-src');
    if (containerSrc) containerSrc.style.display = 'inline-block';
    let srcEmptyMsg = document.getElementById('src-empty-msg');
    if (srcEmptyMsg) srcEmptyMsg.style.display = 'none';

    let viewportSrc = document.getElementById('viewport-src');
    let vpW = viewportSrc && viewportSrc.clientWidth > 100 ? viewportSrc.clientWidth : 500;
    let vpH = viewportSrc && viewportSrc.clientHeight > 100 ? viewportSrc.clientHeight : 500;
    let maxDisplayW = Math.max(200, vpW - 32);
    let maxDisplayH = Math.max(200, vpH - 32);
    let scale = Math.min(1.0, maxDisplayW / rotatedBase.width, maxDisplayH / rotatedBase.height);
    let displayW = Math.max(150, Math.round(rotatedBase.width * scale));
    let displayH = Math.max(150, Math.round(rotatedBase.height * scale));

    // High quality preview resolution (70% of original, i.e. 30% less than original):
    let qualityScale = 0.70;
    let previewW = Math.max(displayW, Math.round(rotatedBase.width * qualityScale));
    let previewH = Math.max(displayH, Math.round(rotatedBase.height * qualityScale));
    previewW = Math.min(rotatedBase.width, previewW);
    previewH = Math.min(rotatedBase.height, previewH);

    canvasSrc.width = previewW;
    canvasSrc.height = previewH;
    canvasSrc.style.width = displayW + 'px';
    canvasSrc.style.height = displayH + 'px';
    let ctx = canvasSrc.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rotatedBase, 0, 0, previewW, previewH);
    
    if (currentMode === 'ID') {
        if (!activeSlot) {
            if (!idLeftCanvas) activeSlot = 'left';
            else if (!idRightCanvas) activeSlot = 'right';
            else activeSlot = 'left';
        } else if (idLeftCanvas && !idRightCanvas && activeSlot === 'left') {
            activeSlot = 'right';
        }
        let s2 = document.getElementById('screen2-title');
        if (s2) s2.innerText = "ID Slots Preview";
        drawIDPreviewComposite();
    } else {
        let canvasDst = document.getElementById('canvas-dst');
        if (canvasDst) {
            canvasDst.style.display = 'block';
            canvasDst.width = previewW;
            canvasDst.height = previewH;
            canvasDst.style.width = displayW + 'px';
            canvasDst.style.height = displayH + 'px';
            let dstCtx = canvasDst.getContext('2d');
            dstCtx.imageSmoothingEnabled = true;
            dstCtx.imageSmoothingQuality = 'high';
            if (imgObj && imgObj.processedCanvas) {
                dstCtx.drawImage(imgObj.processedCanvas, 0, 0, previewW, previewH);
            }
        }
        let docDstEmptyMsg = document.getElementById('doc-dst-empty-msg');
        if (docDstEmptyMsg) docDstEmptyMsg.style.display = 'none';
    }

    zoomSrc = 1.0; panSrc = { x: 0, y: 0 }; updateContainerTransform('src');
    zoomDst = 1.0; panDst = { x: 0, y: 0 }; updateContainerTransform('dst');
    let badgeSrc = document.getElementById('badge-src-dim'); 
    if(badgeSrc) badgeSrc.innerText = `Original: ${rotatedBase.width}x${rotatedBase.height} | Preview: ${previewW}x${previewH}`;
    let badgeDst = document.getElementById('badge-dst-dim'); 
    if(badgeDst) badgeDst.innerText = currentMode === 'ID' ? "ISO CR80 Slot Preview" : "Output Preview (High-Res)";

    document.getElementById('control-rotation').value = imgObj.rotation !== undefined ? imgObj.rotation : 0;
    
    // Load individual saved filter settings
    document.getElementById('slider-contrast').value = imgObj.contrast !== undefined ? imgObj.contrast : 1.0;
    document.getElementById('slider-brightness').value = imgObj.brightness !== undefined ? imgObj.brightness : 0;
    document.getElementById('slider-saturation').value = imgObj.saturation !== undefined ? imgObj.saturation : 1.0;
    let sh = document.getElementById('slider-sharpness');
    if (sh) sh.value = imgObj.sharpness !== undefined ? imgObj.sharpness : 0.0;
    
    shadowRemovalActive = !!imgObj.shadowRemoval;
    let btnSr = document.getElementById('btn-shadow-removal');
    if(btnSr) {
        btnSr.innerText = `Shadow Remov: ${shadowRemovalActive ? 'ON' : 'OFF'}`;
        btnSr.classList.toggle('active', shadowRemovalActive);
    }
    setFilterMode(imgObj.filterMode || 'GRAYSCALE');
    updateSlidersLive();

    let hasLoadedValidCorners = false;
    if (imgObj.corners && imgObj.corners.tl && imgObj.corners.tr && imgObj.corners.br && imgObj.corners.bl) { 
        let isNormalized = true;
        ['tl', 'tr', 'br', 'bl'].forEach(pt => {
            if (imgObj.corners[pt] && (imgObj.corners[pt].x > 1.0 || imgObj.corners[pt].y > 1.0)) {
                isNormalized = false;
            }
        });

        let candidateCorners;
        if (isNormalized) {
            candidateCorners = {
                tl: { x: imgObj.corners.tl.x * displayW, y: imgObj.corners.tl.y * displayH },
                tr: { x: imgObj.corners.tr.x * displayW, y: imgObj.corners.tr.y * displayH },
                br: { x: imgObj.corners.br.x * displayW, y: imgObj.corners.br.y * displayH },
                bl: { x: imgObj.corners.bl.x * displayW, y: imgObj.corners.bl.y * displayH }
            };
        } else {
            candidateCorners = JSON.parse(JSON.stringify(imgObj.corners));
            if (imgObj.cornersDisplayDim && (imgObj.cornersDisplayDim.w !== displayW || imgObj.cornersDisplayDim.h !== displayH)) {
                let ratioW = displayW / imgObj.cornersDisplayDim.w;
                let ratioH = displayH / imgObj.cornersDisplayDim.h;
                ['tl', 'tr', 'br', 'bl'].forEach(pt => {
                    candidateCorners[pt].x = Math.round(candidateCorners[pt].x * ratioW);
                    candidateCorners[pt].y = Math.round(candidateCorners[pt].y * ratioH);
                });
            }
        }
        if (isValidCornerQuad(candidateCorners)) {
            corners = candidateCorners;
            clampCornersToCanvas(displayW, displayH); 
            hasLoadedValidCorners = true;
        }
    }
    
    if (!hasLoadedValidCorners) { 
        initPointersStandard(displayW, displayH); 
    }
    
    updatePointerDOM(); 
    scheduleLiveTransform(100);
}

function initPointersStandard(w, h) {
    let targetW = (typeof w === 'number' && w > 10) ? w : 400;
    let targetH = (typeof h === 'number' && h > 10) ? h : 400;
    corners = {
        tl: { x: 0, y: 0 }, 
        tr: { x: targetW, y: 0 }, 
        br: { x: targetW, y: targetH }, 
        bl: { x: 0, y: targetH }
    };
}

function clampCornersToCanvas(w, h) {
    let pts = ['tl', 'tr', 'br', 'bl']; 
    let invalid = !corners || pts.some(pt => !corners[pt] || !isFinite(corners[pt].x) || !isFinite(corners[pt].y)) || !isValidCornerQuad(corners);
    if (invalid) { 
        initPointersStandard(w, h); 
        return; 
    }
    pts.forEach(pt => { 
        corners[pt].x = Math.max(0, Math.min(corners[pt].x, w)); 
        corners[pt].y = Math.max(0, Math.min(corners[pt].y, h)); 
    });
}

function updatePointerDOM() {
    let canvasSrc = document.getElementById('canvas-src'); 
    if (!canvasSrc) return;
    let displayW = parseFloat(canvasSrc.style.width) || canvasSrc.width;
    let displayH = parseFloat(canvasSrc.style.height) || canvasSrc.height;
    if (displayW && displayH) {
        clampCornersToCanvas(displayW, displayH);
    }
    if (!corners || !isValidCornerQuad(corners)) {
        initPointersStandard(displayW || 400, displayH || 400);
    }
    ['tl', 'tr', 'br', 'bl'].forEach(pt => { 
        let el = document.getElementById('pt-' + pt); 
        if (el && corners[pt]) {
            el.style.left = corners[pt].x + 'px'; 
            el.style.top = corners[pt].y + 'px'; 
            el.style.display = 'block'; 
        }
    });
    let polygon = document.getElementById('crop-polygon');
    if (polygon && corners && corners.tl && corners.tr && corners.br && corners.bl) {
        polygon.setAttribute('points', `${corners.tl.x},${corners.tl.y} ${corners.tr.x},${corners.tr.y} ${corners.br.x},${corners.br.y} ${corners.bl.x},${corners.bl.y}`);
    }
    if(imageArray[activeIndex]) {
        if (displayW > 0 && displayH > 0 && corners && isValidCornerQuad(corners)) {
            imageArray[activeIndex].corners = {
                tl: { x: corners.tl.x / displayW, y: corners.tl.y / displayH },
                tr: { x: corners.tr.x / displayW, y: corners.tr.y / displayH },
                br: { x: corners.br.x / displayW, y: corners.br.y / displayH },
                bl: { x: corners.bl.x / displayW, y: corners.bl.y / displayH }
            };
            imageArray[activeIndex].cornersDisplayDim = { w: displayW, h: displayH };
        }
    }
}

// Dragging corner handles with precision offsets and zoom compensation
let dragStartCorner = { x: 0, y: 0 };
let dragStartMouse = { x: 0, y: 0 };

(function initDragEvents() {
    ['pt-tl', 'pt-tr', 'pt-br', 'pt-bl'].forEach(id => {
        let el = document.getElementById(id); 
        if (!el) return;
        const start = (e) => { 
            e.preventDefault(); 
            e.stopPropagation();
            activeHandle = id.replace('pt-', ''); 
            el.classList.add('active');
            let clientX = e.touches ? e.touches[0].clientX : e.clientX; 
            let clientY = e.touches ? e.touches[0].clientY : e.clientY;
            dragStartMouse = { x: clientX, y: clientY };
            dragStartCorner = { x: corners[activeHandle].x, y: corners[activeHandle].y };
        };
        el.addEventListener('mousedown', start); 
        el.addEventListener('touchstart', start, {passive: false});
    });
    
    const move = (e) => {
        if (!activeHandle) return;
        let canvasSrc = document.getElementById('canvas-src');
        if (!canvasSrc) return;
        let clientX = e.touches ? e.touches[0].clientX : e.clientX; 
        let clientY = e.touches ? e.touches[0].clientY : e.clientY;
        let currentZoom = (typeof zoomSrc === 'number' && zoomSrc > 0) ? zoomSrc : 1.0;
        let dx = (clientX - dragStartMouse.x) / currentZoom;
        let dy = (clientY - dragStartMouse.y) / currentZoom;
        
        let displayW = parseFloat(canvasSrc.style.width) || canvasSrc.width;
        let displayH = parseFloat(canvasSrc.style.height) || canvasSrc.height;
        let newX = Math.max(0, Math.min(dragStartCorner.x + dx, displayW)); 
        let newY = Math.max(0, Math.min(dragStartCorner.y + dy, displayH)); 
        corners[activeHandle] = { x: newX, y: newY }; 
        updatePointerDOM(); 
        scheduleLiveTransform(40);
    };
    
    const end = () => { 
        if(activeHandle) { 
            let el = document.getElementById('pt-' + activeHandle);
            if (el) el.classList.remove('active');
            activeHandle = null; 
            if(activeIndex !== -1) scheduleLiveTransform(30); 
            scheduleStudioDBSave();
        } 
    };
    
    window.addEventListener('mousemove', move); 
    window.addEventListener('touchmove', move, {passive: false}); 
    window.addEventListener('mouseup', end); 
    window.addEventListener('touchend', end);
})();

function rotateActiveImage() { 
    if(activeIndex === -1) return; 
    imageArray[activeIndex].rotation = parseInt(document.getElementById('control-rotation').value, 10); 
    imageArray[activeIndex].corners = null; 
    setActiveImage(activeIndex); 
    scheduleStudioDBSave();
}

function updateSlidersLive() {
    document.getElementById('val-contrast').innerText = document.getElementById('slider-contrast').value; 
    document.getElementById('val-brightness').innerText = document.getElementById('slider-brightness').value; 
    document.getElementById('val-saturation').innerText = document.getElementById('slider-saturation').value;
    let sh = document.getElementById('slider-sharpness');
    if(sh) document.getElementById('val-sharpness').innerText = sh.value;
    if (activeIndex !== -1 && imageArray[activeIndex]) {
        let curr = imageArray[activeIndex];
        curr.contrast = parseFloat(document.getElementById('slider-contrast').value);
        curr.brightness = parseInt(document.getElementById('slider-brightness').value, 10);
        curr.saturation = parseFloat(document.getElementById('slider-saturation').value);
        if (sh) curr.sharpness = parseFloat(sh.value);
    }
    if (activeIndex !== -1) scheduleLiveTransform(50);
    scheduleStudioDBSave();
}

function setFilterMode(mode) { 
    filterMode = mode; 
    let btnThreshold = document.getElementById('btn-effect-threshold');
    if (btnThreshold) btnThreshold.classList.toggle('active', mode === 'THRESHOLD'); 
    let btnGrayscale = document.getElementById('btn-effect-grayscale');
    if (btnGrayscale) btnGrayscale.classList.toggle('active', mode === 'GRAYSCALE'); 
    let btnColor = document.getElementById('btn-effect-color');
    if (btnColor) btnColor.classList.toggle('active', mode === 'COLOR'); 
    let btnEnhance = document.getElementById('btn-effect-enhance');
    if (btnEnhance) btnEnhance.classList.toggle('active', mode === 'ENHANCE');
    if (activeIndex !== -1 && imageArray[activeIndex]) {
        imageArray[activeIndex].filterMode = mode;
    }
    if (activeIndex !== -1) scheduleLiveTransform(20); 
    scheduleStudioDBSave();
}

function toggleShadowRemoval() {
    shadowRemovalActive = !shadowRemovalActive;
    let btn = document.getElementById('btn-shadow-removal');
    if(btn) {
        btn.innerText = `Shadow Remov: ${shadowRemovalActive ? 'ON' : 'OFF'}`;
        btn.classList.toggle('active', shadowRemovalActive);
    }
    if (activeIndex !== -1 && imageArray[activeIndex]) {
        imageArray[activeIndex].shadowRemoval = shadowRemovalActive;
    }
    if(activeIndex !== -1) scheduleLiveTransform(20);
    scheduleStudioDBSave();
}



/**
 * CORE IMAGE PROCESSING WITH MEMORY LEAK PREVENTION (OpenCV.js)
 * Wraps all Mat allocations in try...finally blocks with explicit .delete() calls.
 */
function processImageTransform() {
    if (activeIndex === -1) return; 
    if (typeof cv === 'undefined' || !cv.Mat) { 
        whenOpenCvReady(processImageTransform); 
        return; 
    }
    
    let baseSrc = cv.imread('canvas-hidden'); 
    let canvasSrc = document.getElementById('canvas-src');
    let displayW = parseFloat(canvasSrc.style.width) || canvasSrc.width; 
    let displayH = parseFloat(canvasSrc.style.height) || canvasSrc.height;
    let scaleX = baseSrc.cols / displayW; 
    let scaleY = baseSrc.rows / displayH;
    
    let srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
        corners.tl.x * scaleX, corners.tl.y * scaleY, 
        corners.tr.x * scaleX, corners.tr.y * scaleY, 
        corners.br.x * scaleX, corners.br.y * scaleY, 
        corners.bl.x * scaleX, corners.bl.y * scaleY
    ]);
    
    let widthTop = Math.sqrt(Math.pow((corners.tr.x - corners.tl.x)*scaleX, 2) + Math.pow((corners.tr.y - corners.tl.y)*scaleY, 2));
    let widthBottom = Math.sqrt(Math.pow((corners.br.x - corners.bl.x)*scaleX, 2) + Math.pow((corners.br.y - corners.bl.y)*scaleY, 2));
    let heightLeft = Math.sqrt(Math.pow((corners.bl.x - corners.tl.x)*scaleX, 2) + Math.pow((corners.bl.y - corners.tl.y)*scaleY, 2));
    let heightRight = Math.sqrt(Math.pow((corners.br.x - corners.tr.x)*scaleX, 2) + Math.pow((corners.br.y - corners.tr.y)*scaleY, 2));
    
    let dynamicWidth = Math.max(widthTop, widthBottom); 
    let dynamicHeight = Math.max(heightLeft, heightRight);
    if(dynamicWidth < 100) dynamicWidth = 600; 
    if(dynamicHeight < 100) dynamicHeight = 400;
    
    let dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, dynamicWidth, 0, dynamicWidth, dynamicHeight, 0, dynamicHeight]);
    let M_trans = cv.getPerspectiveTransform(srcPts, dstPts); 
    
    let transformed = new cv.Mat();
    let finalMat = new cv.Mat();

    try {
        cv.warpPerspective(baseSrc, transformed, M_trans, new cv.Size(dynamicWidth, dynamicHeight));
        
        let alpha = parseFloat(document.getElementById('slider-contrast').value); 
        let beta = parseInt(document.getElementById('slider-brightness').value, 10);
        let sat = parseFloat(document.getElementById('slider-saturation').value);
        let sharpness = parseFloat(document.getElementById('slider-sharpness') ? document.getElementById('slider-sharpness').value : 0.0);

        if (filterMode === 'COLOR' || filterMode === 'ENHANCE') {
            let colorProcessed = new cv.Mat();
            if(filterMode === 'ENHANCE') {
                // Histogram equalization on YCrCb for color enhancement
                let ycrcb = new cv.Mat();
                cv.cvtColor(transformed, ycrcb, cv.COLOR_RGBA2RGB);
                cv.cvtColor(ycrcb, ycrcb, cv.COLOR_RGB2YCrCb);
                let channels = new cv.MatVector();
                cv.split(ycrcb, channels);
                let yChannel = channels.get(0);
                cv.equalizeHist(yChannel, yChannel);
                cv.merge(channels, ycrcb);
                cv.cvtColor(ycrcb, colorProcessed, cv.COLOR_YCrCb2RGB);
                cv.cvtColor(colorProcessed, colorProcessed, cv.COLOR_RGB2RGBA);
                ycrcb.delete(); channels.delete(); yChannel.delete();
            } else {
                transformed.copyTo(colorProcessed);
            }

            if(sat !== 1.0) {
                let hsv = new cv.Mat();
                cv.cvtColor(colorProcessed, hsv, cv.COLOR_RGBA2RGB);
                cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);
                let channels = new cv.MatVector();
                cv.split(hsv, channels);
                let s = channels.get(1);
                s.convertTo(s, -1, sat, 0);
                cv.merge(channels, hsv);
                let tempRgb = new cv.Mat();
                cv.cvtColor(hsv, tempRgb, cv.COLOR_HSV2RGB);
                cv.cvtColor(tempRgb, colorProcessed, cv.COLOR_RGB2RGBA);
                hsv.delete(); channels.delete(); s.delete(); tempRgb.delete();
            }

            colorProcessed.convertTo(finalMat, -1, alpha, beta);
            colorProcessed.delete();
        } 
        else {
            // Grayscale or Threshold (Document Scanner Mode)
            let outGray = new cv.Mat(); 
            cv.cvtColor(transformed, outGray, cv.COLOR_RGBA2GRAY);

            let bleachedGray = new cv.Mat();
            if (shadowRemovalActive) {
                let bgEstimate = new cv.Mat(); 
                let bgKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(51, 51));
                cv.morphologyEx(outGray, bgEstimate, cv.MORPH_DILATE, bgKernel); 
                cv.GaussianBlur(bgEstimate, bgEstimate, new cv.Size(51, 51), 0, 0);
                let divided = new cv.Mat(); 
                cv.divide(outGray, bgEstimate, divided, 255, -1);
                divided.convertTo(bleachedGray, -1, alpha, beta);
                bgEstimate.delete(); bgKernel.delete(); divided.delete();
            } else {
                outGray.convertTo(bleachedGray, -1, alpha, beta);
            }
            
            if (filterMode === 'THRESHOLD') { 
                let thresh = new cv.Mat();
                cv.threshold(bleachedGray, thresh, 175, 255, cv.THRESH_BINARY);
                cv.cvtColor(thresh, finalMat, cv.COLOR_GRAY2RGBA);
                thresh.delete();
            } else { 
                // GRAYSCALE / DOC SCANNER
                cv.cvtColor(bleachedGray, finalMat, cv.COLOR_GRAY2RGBA);
            }
            outGray.delete(); 
            bleachedGray.delete();
        }

        // Apply Unsharp Mask if sharpness > 0
        if (sharpness > 0) {
            let blurredImage = new cv.Mat();
            cv.GaussianBlur(finalMat, blurredImage, new cv.Size(0, 0), 3);
            cv.addWeighted(finalMat, 1.0 + sharpness, blurredImage, -sharpness, 0, finalMat);
            blurredImage.delete();
        }

        let canvasDst = document.getElementById('canvas-dst'); 
        tempCurrentCroppedCanvas = document.createElement('canvas'); 
        tempCurrentCroppedCanvas.width = finalMat.cols; 
        tempCurrentCroppedCanvas.height = finalMat.rows;
        let tempCtx = tempCurrentCroppedCanvas.getContext('2d');
        tempCtx.imageSmoothingEnabled = true;
        tempCtx.imageSmoothingQuality = 'high';
        cv.imshow(tempCurrentCroppedCanvas, finalMat);
        
        if (currentMode === 'DOC') { 
            if (canvasDst) {
                canvasDst.style.display = 'block';
                canvasDst.width = finalMat.cols;
                canvasDst.height = finalMat.rows;
                let viewportDst = document.getElementById('viewport-dst');
                let vpDstW = viewportDst && viewportDst.clientWidth > 100 ? viewportDst.clientWidth : 500;
                let vpDstH = viewportDst && viewportDst.clientHeight > 100 ? viewportDst.clientHeight : 500;
                let dstScale = Math.min(1.0, (vpDstW - 32) / finalMat.cols, (vpDstH - 32) / finalMat.rows);
                let dstDisplayW = Math.max(150, Math.round(finalMat.cols * dstScale));
                let dstDisplayH = Math.max(150, Math.round(finalMat.rows * dstScale));
                canvasDst.style.width = dstDisplayW + 'px';
                canvasDst.style.height = dstDisplayH + 'px';
                let dstCtx = canvasDst.getContext('2d');
                dstCtx.imageSmoothingEnabled = true;
                dstCtx.imageSmoothingQuality = 'high';
                cv.imshow('canvas-dst', finalMat);
            }
            let docDstEmptyMsg = document.getElementById('doc-dst-empty-msg');
            if (docDstEmptyMsg) docDstEmptyMsg.style.display = 'none';
            if (imageArray[activeIndex]) imageArray[activeIndex].processedCanvas = tempCurrentCroppedCanvas; 
        } else { 
            let s2 = document.getElementById('screen2-title');
            if (s2) s2.innerText = "ID Slots Preview"; 
            drawIDPreviewComposite();
        }

        const btnSaveImg = document.getElementById('btn-save-img');
        if (btnSaveImg) btnSaveImg.disabled = false;
        const btnPrintDoc = document.getElementById('btn-print-doc');
        if (btnPrintDoc) btnPrintDoc.disabled = false;
        const btnDocSendTo = document.getElementById('btn-doc-send-to');
        if (btnDocSendTo) btnDocSendTo.disabled = false;

    } finally {
        baseSrc.delete(); 
        srcPts.delete(); 
        dstPts.delete(); 
        M_trans.delete(); 
        transformed.delete(); 
        finalMat.delete();
    }
}

function drawIDPreviewComposite() {
    if (currentMode !== 'ID') return; 
    let canvasDst = document.getElementById('canvas-id-dst'); 
    if (!canvasDst) return;

    let orient = document.getElementById('control-id-orientation') ? document.getElementById('control-id-orientation').value : 'H';
    let wBox = 800;
    let hBox;
    
    if (orient === 'V') {
        // Vertical ISO CR80 aspect ratio (53.98mm width × 85.6mm height)
        hBox = Math.round(wBox * (85.6 / 53.98));
    } else {
        // Horizontal ISO CR80 aspect ratio (85.6mm width × 53.98mm height)
        hBox = Math.round(wBox * (53.98 / 85.6));
    }
    
    const headerSpace = 24;
    const gap = 16;
    const totalHeight = headerSpace + hBox + gap + headerSpace + hBox + 16;

    // Save slot geometry for click-hit detection
    idSlotGeometry.slot1 = { y: headerSpace, h: hBox, w: wBox };
    idSlotGeometry.slot2 = { y: headerSpace + hBox + gap + headerSpace, h: hBox, w: wBox };

    canvasDst.width = wBox;
    canvasDst.height = totalHeight;

    // Fit slots 1 and 2 inside canvas viewport so scrolling is not required
    let viewportDst = document.getElementById('viewport-dst');
    let vpDstW = viewportDst && viewportDst.clientWidth > 50 ? viewportDst.clientWidth : 500;
    let vpDstH = viewportDst && viewportDst.clientHeight > 50 ? viewportDst.clientHeight : 500;

    let availW = Math.max(100, vpDstW - 20);
    let availH = Math.max(100, vpDstH - 20);

    let fitScale = Math.min(availW / canvasDst.width, availH / canvasDst.height);
    let displayW = Math.max(120, Math.round(canvasDst.width * fitScale));
    let displayH = Math.max(120, Math.round(canvasDst.height * fitScale));

    canvasDst.style.width = displayW + 'px';
    canvasDst.style.height = displayH + 'px';

    zoomDst = 1.0;
    panDst = { x: 0, y: 0 };
    updateContainerTransform('dst');

    let ctx = canvasDst.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = "#ffffff"; 
    ctx.fillRect(0, 0, canvasDst.width, canvasDst.height); 

    // Target slot fallback
    let currentTarget = activeSlot || (!idLeftCanvas ? 'left' : (!idRightCanvas ? 'right' : 'left'));

    // Highlight the active assign buttons in sidebar
    let btnLeft = document.getElementById('btn-assign-left');
    let btnRight = document.getElementById('btn-assign-right');
    if (btnLeft && btnRight) {
        if (currentTarget === 'left') {
            btnLeft.style.boxShadow = '0 0 0 2px #0284c7, 0 4px 12px rgba(2, 132, 199, 0.4)';
            btnRight.style.boxShadow = '';
        } else {
            btnRight.style.boxShadow = '0 0 0 2px #b621fe, 0 4px 12px rgba(182, 33, 254, 0.4)';
            btnLeft.style.boxShadow = '';
        }
    }

    // Live cropped canvas of currently active image
    let liveCanvas = tempCurrentCroppedCanvas || null;

    // Show live preview in Slot 1 if target is 'left' and liveCanvas exists
    let showLiveInSlot1 = (currentTarget === 'left' && liveCanvas !== null);
    let slot1Source = showLiveInSlot1 ? liveCanvas : idLeftCanvas;

    // Show live preview in Slot 2 if target is 'right' and liveCanvas exists
    let showLiveInSlot2 = (currentTarget === 'right' && liveCanvas !== null);
    let slot2Source = showLiveInSlot2 ? liveCanvas : idRightCanvas;

    // ─── SLOT 1 (TOP) ───
    const y1 = headerSpace;
    const isSlot1Active = (currentTarget === 'left');
    
    ctx.fillStyle = isSlot1Active ? "#0284c7" : "#0f172a"; 
    ctx.font = isSlot1Active ? "bold 13px Inter, sans-serif" : "600 13px Inter, sans-serif";
    ctx.textAlign = "left";
    let slot1Label = "Slot 1 (Front)";
    if (showLiveInSlot1) {
        slot1Label += " • LIVE PREVIEW";
    } else if (idLeftCanvas) {
        slot1Label += " • ASSIGNED ✓";
    }
    ctx.fillText(slot1Label, 8, y1 - 8);

    if (slot1Source) { 
        ctx.drawImage(slot1Source, 0, y1, wBox, hBox); 
        if (showLiveInSlot1) {
            ctx.strokeStyle = "#0284c7"; 
            ctx.lineWidth = 4; 
            ctx.strokeRect(0, y1, wBox, hBox); 
            // Draw live badge
            ctx.fillStyle = "#0284c7";
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(wBox - 116, y1 + 8, 108, 22, 6);
            else ctx.rect(wBox - 116, y1 + 8, 108, 22);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 10px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("● LIVE PREVIEW", wBox - 62, y1 + 23);
            ctx.textAlign = "left";
        } else if (idLeftCanvas) {
            ctx.strokeStyle = isSlot1Active ? "#0284c7" : "#10b981"; 
            ctx.lineWidth = 3; 
            ctx.strokeRect(0, y1, wBox, hBox); 
            // Draw green check badge
            ctx.fillStyle = "#10b981";
            ctx.beginPath();
            ctx.arc(wBox - 16, y1 + 16, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 11px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("✓", wBox - 16, y1 + 20);
            ctx.textAlign = "left";
        }
    } else { 
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(0, y1, wBox, hBox);
        ctx.strokeStyle = isSlot1Active ? "#0284c7" : "#cbd5e1"; 
        ctx.lineWidth = isSlot1Active ? 3 : 2; 
        ctx.strokeRect(0, y1, wBox, hBox); 
        ctx.textAlign = "center";
        ctx.fillStyle = "#475569";
        ctx.font = "bold 13px Inter, sans-serif";
        ctx.fillText("Slot 1 (Front) — Empty", wBox / 2, y1 + (hBox / 2) - 6);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "12px Inter, sans-serif";
        ctx.fillText("Select image & click 'Send to Slot 1'", wBox / 2, y1 + (hBox / 2) + 12);
        ctx.textAlign = "left";
    }

    // ─── SLOT 2 (BOTTOM) ───
    const y2 = y1 + hBox + gap + headerSpace;
    const isSlot2Active = (currentTarget === 'right');

    ctx.fillStyle = isSlot2Active ? "#b621fe" : "#0f172a"; 
    ctx.font = isSlot2Active ? "bold 13px Inter, sans-serif" : "600 13px Inter, sans-serif";
    ctx.textAlign = "left";
    let slot2Label = "Slot 2 (Back)";
    if (showLiveInSlot2) {
        slot2Label += " • LIVE PREVIEW";
    } else if (idRightCanvas) {
        slot2Label += " • ASSIGNED ✓";
    }
    ctx.fillText(slot2Label, 8, y2 - 8);

    if (slot2Source) { 
        ctx.drawImage(slot2Source, 0, y2, wBox, hBox); 
        if (showLiveInSlot2) {
            ctx.strokeStyle = "#b621fe"; 
            ctx.lineWidth = 4; 
            ctx.strokeRect(0, y2, wBox, hBox); 
            // Draw live badge
            ctx.fillStyle = "#b621fe";
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(wBox - 116, y2 + 8, 108, 22, 6);
            else ctx.rect(wBox - 116, y2 + 8, 108, 22);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 10px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("● LIVE PREVIEW", wBox - 62, y2 + 23);
            ctx.textAlign = "left";
        } else if (idRightCanvas) {
            ctx.strokeStyle = isSlot2Active ? "#b621fe" : "#10b981"; 
            ctx.lineWidth = 3; 
            ctx.strokeRect(0, y2, wBox, hBox); 
            // Draw green check badge
            ctx.fillStyle = "#10b981";
            ctx.beginPath();
            ctx.arc(wBox - 16, y2 + 16, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 11px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("✓", wBox - 16, y2 + 20);
            ctx.textAlign = "left";
        }
    } else { 
        ctx.fillStyle = "#f8fafc";
        ctx.fillRect(0, y2, wBox, hBox);
        ctx.strokeStyle = isSlot2Active ? "#b621fe" : "#cbd5e1"; 
        ctx.lineWidth = isSlot2Active ? 3 : 2; 
        ctx.strokeRect(0, y2, wBox, hBox); 
        ctx.textAlign = "center";
        ctx.fillStyle = "#475569";
        ctx.font = "bold 13px Inter, sans-serif";
        ctx.fillText("Slot 2 (Back) — Empty", wBox / 2, y2 + (hBox / 2) - 6);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "12px Inter, sans-serif";
        ctx.fillText("Select image & click 'Send to Slot 2'", wBox / 2, y2 + (hBox / 2) + 12);
        ctx.textAlign = "left";
    }
}

function saveCurrentPairToBucket() {
    if (!idLeftCanvas && !idRightCanvas) { 
        alert("Load content into slots first before saving!"); 
        return; 
    }
    let savedLeft = null; 
    if(idLeftCanvas) { 
        savedLeft = document.createElement('canvas'); 
        savedLeft.width = idLeftCanvas.width; 
        savedLeft.height = idLeftCanvas.height; 
        savedLeft.getContext('2d').drawImage(idLeftCanvas, 0, 0); 
    }
    let savedRight = null; 
    if(idRightCanvas) { 
        savedRight = document.createElement('canvas'); 
        savedRight.width = idRightCanvas.width; 
        savedRight.height = idRightCanvas.height; 
        savedRight.getContext('2d').drawImage(idRightCanvas, 0, 0); 
    }
    bucketPairs.push({ id: Date.now() + Math.random(), left: savedLeft, right: savedRight }); 
    activeBucketIdx = bucketPairs.length - 1; 
    rebuildBucketDOM();
    saveStudioToDB('ID');
}

function rebuildBucketDOM() {
    let row = document.getElementById('bucket-item-row'); 
    row.innerHTML = '';
    let countEl = document.getElementById('bucket-count');
    if (countEl) countEl.innerText = `${bucketPairs.length} Sets`;

    if(bucketPairs.length === 0) { 
        row.innerHTML = '<span style="color: var(--text-muted); font-size: 13px;">No layout bundles saved yet.</span>'; 
        activeBucketIdx = -1; 
        return; 
    }
    bucketPairs.forEach((pair, index) => {
        let card = document.createElement('div'); 
        card.className = `bucket-pair-card ${index === activeBucketIdx ? 'selected' : ''}`; 
        card.onclick = () => loadBucketPairToWorkspace(index);
        
        let del = document.createElement('button'); 
        del.className = 'bucket-pair-delete'; 
        del.innerHTML = '&times;';
        del.onclick = (e) => { 
            e.stopPropagation(); 
            bucketPairs.splice(index, 1); 
            if(activeBucketIdx >= bucketPairs.length) activeBucketIdx = bucketPairs.length - 1; 
            if(activeBucketIdx !== -1) { 
                loadBucketPairToWorkspace(activeBucketIdx); 
            } else { 
                idLeftCanvas = null; 
                idRightCanvas = null; 
                tempCurrentCroppedCanvas = null; 
                drawIDPreviewComposite(); 
            } 
            rebuildBucketDOM(); 
            saveStudioToDB('ID');
        };
        
        let slotL = document.createElement('div'); 
        slotL.className = 'bucket-mini-slot'; 
        if(pair.left) { 
            let imgL = document.createElement('img'); 
            imgL.src = pair.left.toDataURL('image/jpeg', 0.4); 
            slotL.appendChild(imgL); 
        } else { 
            slotL.innerText = 'Empty'; 
        }
        
        let slotR = document.createElement('div'); 
        slotR.className = 'bucket-mini-slot'; 
        if(pair.right) { 
            let imgR = document.createElement('img'); 
            imgR.src = pair.right.toDataURL('image/jpeg', 0.4); 
            slotR.appendChild(imgR); 
        } else { 
            slotR.innerText = 'Empty'; 
        }
        
        let lbl = document.createElement('div'); 
        lbl.className = 'bucket-label'; 
        lbl.innerText = `Set #${index + 1}`; 
        
        card.appendChild(del); 
        card.appendChild(slotL); 
        card.appendChild(slotR); 
        card.appendChild(lbl); 
        row.appendChild(card);
    });
}

function loadBucketPairToWorkspace(index) {
    if(index < 0 || index >= bucketPairs.length) return;
    activeBucketIdx = index; 
    let pair = bucketPairs[index];
    
    if(pair.left) { 
        idLeftCanvas = document.createElement('canvas'); 
        idLeftCanvas.width = pair.left.width; 
        idLeftCanvas.height = pair.left.height; 
        idLeftCanvas.getContext('2d').drawImage(pair.left, 0, 0); 
    } else { 
        idLeftCanvas = null; 
    }
    
    if(pair.right) { 
        idRightCanvas = document.createElement('canvas'); 
        idRightCanvas.width = pair.right.width; 
        idRightCanvas.height = pair.right.height; 
        idRightCanvas.getContext('2d').drawImage(pair.right, 0, 0); 
    } else { 
        idRightCanvas = null; 
    }
    
    document.getElementById('screen2-title').innerText = "ID Composite Studio View Slots"; 
    rebuildBucketDOM(); 
    drawIDPreviewComposite();
}

function printScannedDocument() { 
    let activeCanvas = getOrGenerateCroppedCanvas();
    if (!activeCanvas) { 
        alert("Please load or select an image first!"); 
        return; 
    } 
    openDocPrintPreview(); 
}

function openDocPrintPreview() {
    let activeCanvas = getOrGenerateCroppedCanvas();
    if (!activeCanvas) return;
    let modal = document.getElementById('doc-print-modal'); 
    let img = document.getElementById('doc-print-img'); 
    img.src = activeCanvas.toDataURL('image/jpeg', 1.0);
    docPrintState = { x: 0, y: 0, scale: 1, dragging: false, startX: 0, startY: 0, baseX: 0, baseY: 0 }; 
    document.getElementById('doc-print-scale').value = 100; 
    modal.classList.add('active'); 
    modal.setAttribute('aria-hidden', 'false'); 
    updateDocPrintPreview();
}

function updateDocPrintPreview() {
    let img = document.getElementById('doc-print-img'); 
    if (!img) return;
    docPrintState.scale = parseInt(document.getElementById('doc-print-scale').value, 10) / 100; 
    img.style.width = (docPrintState.scale * 100) + '%'; 
    img.style.left = docPrintState.x + 'px'; 
    img.style.top = docPrintState.y + 'px';
}

function closeDocPrintPreview() { 
    let modal = document.getElementById('doc-print-modal'); 
    modal.classList.remove('active'); 
    modal.setAttribute('aria-hidden', 'true'); 
}

async function confirmDocPrintPreview() {
    let printArea = document.getElementById('print-area'); 
    let img = document.getElementById('doc-print-img'); 
    if (!printArea || !img) return;
    printArea.innerHTML = '';
    
    let wrapper = document.createElement('div'); 
    wrapper.className = 'print-doc-stage'; 
    let printImg = document.createElement('img'); 
    printImg.src = img.src; 
    printImg.className = 'print-doc-draggable';
    printImg.style.width = (docPrintState.scale * 210) + 'mm'; 
    printImg.style.left = (docPrintState.x * 0.264583) + 'mm'; 
    printImg.style.top = (docPrintState.y * 0.264583) + 'mm';
    
    wrapper.appendChild(printImg); 
    printArea.appendChild(wrapper); 
    closeDocPrintPreview(); 

    if (printImg.decode) {
        await printImg.decode().catch(() => {});
    }
    await new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(resolve, 150);
            });
        });
    });

    window.print();
}

/**
 * ID CARD PRINTING WITH ISO CR80 DIMENSIONS, CORNER RADIUS, AND BATCH GRID
 * Ensures images are fully decoded and painted before opening the browser print dialog.
 */
async function printIDCards(isSingle) {
    if (isSingle && !idLeftCanvas && !idRightCanvas) { 
        alert("No card assigned inside slots!"); 
        return; 
    }
    if (!isSingle && (!idLeftCanvas || !idRightCanvas)) { 
        alert("Both left and right slots must be assigned for side-by-side printing!"); 
        return; 
    }
    
    let printArea = document.getElementById('print-area'); 
    if (!printArea) {
        printArea = document.createElement('div');
        printArea.id = 'print-area';
        document.body.appendChild(printArea);
    }
    printArea.innerHTML = '';
    
    let orient = document.getElementById('control-id-orientation') ? document.getElementById('control-id-orientation').value : 'H';
    let includeCrop = document.getElementById('check-crop-marks') ? document.getElementById('check-crop-marks').checked : true;
    let cardClass = orient === 'V' ? 'print-card vertical' : 'print-card';
    if(includeCrop) cardClass += ' print-card-trimmed';

    let imgsToLoad = [];

    if (isSingle) {
        let activeCanvas = idLeftCanvas ? idLeftCanvas : idRightCanvas; 
        let img = document.createElement('img'); 
        img.className = cardClass;
        img.src = activeCanvas.toDataURL('image/png'); 
        imgsToLoad.push(img);
        
        let wrapper = document.createElement('div'); 
        wrapper.className = 'print-center' + (orient === 'V' ? ' vertical' : ''); 
        wrapper.appendChild(img); 
        printArea.appendChild(wrapper);
    } else {
        let imgL = document.createElement('img'); 
        imgL.className = cardClass;
        imgL.src = idLeftCanvas.toDataURL('image/png'); 
        imgsToLoad.push(imgL);
        
        let imgR = document.createElement('img'); 
        imgR.className = cardClass;
        imgR.src = idRightCanvas.toDataURL('image/png'); 
        imgsToLoad.push(imgR);
        
        let wrapper = document.createElement('div'); 
        wrapper.className = 'print-container' + (orient === 'V' ? ' vertical' : ''); 
        wrapper.appendChild(imgL); 
        wrapper.appendChild(imgR); 
        printArea.appendChild(wrapper);
    }

    // Await full image decoding so pixels are ready on the first print trigger
    await Promise.all(imgsToLoad.map(img => {
        if (img.decode) {
            return img.decode().catch(() => new Promise(res => {
                if (img.complete) return res();
                img.onload = res;
                img.onerror = res;
            }));
        }
        return new Promise(res => {
            if (img.complete) return res();
            img.onload = res;
            img.onerror = res;
        });
    }));

    // Double frame wait + timeout to ensure compositor commits raster before print dialog snapshots
    await new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(resolve, 150);
            });
        });
    });

    window.print();
}

function processAllImages() {
    if (imageArray.length === 0) return; 
    saveCurrentActiveImageState();

    // Get current master adjustment settings from UI controls
    let sc = document.getElementById('slider-contrast');
    let sb = document.getElementById('slider-brightness');
    let ss = document.getElementById('slider-saturation');
    let sh = document.getElementById('slider-sharpness');
    let rot = document.getElementById('control-rotation');

    let masterContrast = sc ? parseFloat(sc.value) : 1.0;
    let masterBrightness = sb ? parseInt(sb.value, 10) : 0;
    let masterSaturation = ss ? parseFloat(ss.value) : 1.0;
    let masterSharpness = sh ? parseFloat(sh.value) : 0.0;
    let masterShadowRemoval = shadowRemovalActive;
    let masterFilterMode = filterMode || 'GRAYSCALE';
    let masterRotation = rot ? parseInt(rot.value, 10) : 0;

    // Apply adjustments to all pages
    imageArray.forEach(imgObj => {
        imgObj.contrast = masterContrast;
        imgObj.brightness = masterBrightness;
        imgObj.saturation = masterSaturation;
        imgObj.sharpness = masterSharpness;
        imgObj.shadowRemoval = masterShadowRemoval;
        imgObj.filterMode = masterFilterMode;
        imgObj.rotation = masterRotation;
    });

    let indexBackup = activeIndex !== -1 ? activeIndex : 0;
    let btnOpt = document.getElementById('btn-optimize-all');
    let originalText = btnOpt ? btnOpt.innerText : 'Batch Optimize All Pages';

    if (btnOpt) {
        btnOpt.disabled = true;
    }

    let chainProcess = (idx) => {
        if (idx >= imageArray.length) { 
            setActiveImage(indexBackup); 
            if (btnOpt) {
                btnOpt.disabled = false;
                btnOpt.innerText = originalText;
            }
            alert(`✅ Batch optimization completed! Applied settings to all ${imageArray.length} page(s).`);
            return; 
        }

        if (btnOpt) {
            btnOpt.innerText = `Processing (${idx + 1}/${imageArray.length})...`;
        }

        setActiveImage(idx); 
        setTimeout(() => { 
            processImageTransform(); 
            setTimeout(() => { 
                chainProcess(idx + 1); 
            }, 80); 
        }, 80);
    };
    chainProcess(0);
}

function initDocPrintDrag() {
    let img = document.getElementById('doc-print-img'); 
    if (!img || img.dataset.dragReady === '1') return; 
    img.dataset.dragReady = '1';
    
    const start = (e) => { 
        e.preventDefault(); 
        let p = e.touches ? e.touches[0] : e; 
        docPrintState.dragging = true; 
        docPrintState.startX = p.clientX; 
        docPrintState.startY = p.clientY; 
        docPrintState.baseX = docPrintState.x; 
        docPrintState.baseY = docPrintState.y; 
    };
    
    const move = (e) => { 
        if (!docPrintState.dragging) return; 
        let p = e.touches ? e.touches[0] : e; 
        docPrintState.x = docPrintState.baseX + (p.clientX - docPrintState.startX); 
        docPrintState.y = docPrintState.baseY + (p.clientY - docPrintState.startY); 
        updateDocPrintPreview(); 
    };
    
    const end = () => { 
        docPrintState.dragging = false; 
    };
    
    img.addEventListener('mousedown', start); 
    img.addEventListener('touchstart', start, {passive:false}); 
    window.addEventListener('mousemove', move); 
    window.addEventListener('touchmove', move, {passive:false}); 
    window.addEventListener('mouseup', end); 
    window.addEventListener('touchend', end);
}

window.addEventListener('load', initDocPrintDrag);

// Universal Image Download Filename Modal state and handlers
let pendingDownloadDataUrl = null;
let pendingDownloadBlob = null;
let pendingDownloadDefaultExt = 'jpg';

function onDownloadExtChange(newExt) {
    pendingDownloadDefaultExt = (newExt || 'jpg').replace(/^\./, '').toLowerCase();
}

function triggerDownloadWithFilenameModal(dataUrl, defaultName, ext = 'jpg', dimText = '', estSizeText = '', blob = null) {
    if (!dataUrl && !blob) return;
    pendingDownloadDataUrl = dataUrl || '';
    pendingDownloadBlob = blob || null;
    pendingDownloadDefaultExt = ext.replace(/^\./, '').toLowerCase();

    let modal = document.getElementById('dl-filename-modal');
    let input = document.getElementById('dlModalFilenameInput');
    let extSelect = document.getElementById('dlModalExtSelect');
    let dimEl = document.getElementById('dlModalDim');
    let sizeEl = document.getElementById('dlModalEstSize');

    if (extSelect) {
        // Find matching option or set value
        let match = Array.from(extSelect.options).find(o => o.value === pendingDownloadDefaultExt || (pendingDownloadDefaultExt === 'jpeg' && o.value === 'jpg'));
        if (match) {
            extSelect.value = match.value;
            pendingDownloadDefaultExt = match.value;
        } else {
            extSelect.value = 'jpg';
            pendingDownloadDefaultExt = 'jpg';
        }
    }
    if (input) {
        input.value = defaultName ? defaultName.replace(/\.[a-zA-Z0-9]+$/, '') : `Image_Export_${Date.now()}`;
    }
    if (dimEl) dimEl.textContent = dimText ? `Dimensions: ${dimText}` : '';
    if (sizeEl) sizeEl.textContent = estSizeText ? `Size: ${estSizeText}` : '';

    if (modal) {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(() => {
            if (input) {
                input.focus();
                input.select();
            }
        }, 50);
    } else {
        // Fallback if modal DOM element not found
        let link = document.createElement('a');
        link.download = `${defaultName}.${pendingDownloadDefaultExt}`;
        if (pendingDownloadBlob) {
            const objUrl = URL.createObjectURL(pendingDownloadBlob);
            link.href = objUrl;
            link.click();
            setTimeout(() => URL.revokeObjectURL(objUrl), 5000);
        } else {
            link.href = dataUrl;
            link.click();
        }
    }
}

function closeDownloadFilenameModal() {
    let modal = document.getElementById('dl-filename-modal');
    if (modal) {
        modal.style.display = 'none';
        modal.setAttribute('aria-hidden', 'true');
    }
    pendingDownloadDataUrl = null;
    pendingDownloadBlob = null;
}

async function confirmDownloadFilenameModal() {
    if (!pendingDownloadDataUrl && !pendingDownloadBlob) {
        closeDownloadFilenameModal();
        return;
    }
    let input = document.getElementById('dlModalFilenameInput');
    let extSelect = document.getElementById('dlModalExtSelect');
    if (extSelect) {
        pendingDownloadDefaultExt = (extSelect.value || 'jpg').toLowerCase();
    }
    let rawName = input ? input.value.trim() : '';
    if (!rawName) {
        rawName = `Scan_Export_${Date.now()}`;
    }
    // Sanitize filename
    let cleanName = rawName.replace(/[/\\?%*:|"<>]/g, '_').trim();
    cleanName = cleanName.replace(/\.[a-zA-Z0-9]+$/, '');
    let finalFilename = `${cleanName}.${pendingDownloadDefaultExt}`;

    // Rule 1: Direct exact Blob download (Zero re-encoding pass!)
    if (pendingDownloadBlob) {
        const objectUrl = URL.createObjectURL(pendingDownloadBlob);
        const link = document.createElement('a');
        link.download = finalFilename;
        link.href = objectUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
        closeDownloadFilenameModal();
        return;
    }

    const currentUrl = pendingDownloadDataUrl;
    const targetExt = pendingDownloadDefaultExt;

    // Rule 2: If format matches current URL, download directly without re-encoding
    let currentExt = 'jpg';
    if (currentUrl.startsWith('data:image/png')) currentExt = 'png';
    else if (currentUrl.startsWith('data:image/webp')) currentExt = 'webp';

    if (currentExt === targetExt || (currentExt === 'jpeg' && targetExt === 'jpg') || (currentExt === 'jpg' && targetExt === 'jpeg')) {
        let link = document.createElement('a');
        link.download = finalFilename;
        link.href = currentUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        closeDownloadFilenameModal();
        return;
    }

    if (targetExt === 'pdf') {
        const img = new Image();
        img.onload = () => {
            try {
                const { jsPDF } = window.jspdf || {};
                if (jsPDF) {
                    const orientation = img.width > img.height ? 'landscape' : 'portrait';
                    const pdf = new jsPDF({
                        orientation: orientation,
                        unit: 'px',
                        format: [img.width, img.height]
                    });
                    pdf.addImage(currentUrl, 'JPEG', 0, 0, img.width, img.height);
                    pdf.save(finalFilename);
                } else {
                    let link = document.createElement('a');
                    link.download = finalFilename;
                    link.href = currentUrl;
                    link.click();
                }
            } catch (err) {
                let link = document.createElement('a');
                link.download = finalFilename;
                link.href = currentUrl;
                link.click();
            }
            closeDownloadFilenameModal();
        };
        img.onerror = () => {
            let link = document.createElement('a');
            link.download = finalFilename;
            link.href = currentUrl;
            link.click();
            closeDownloadFilenameModal();
        };
        img.src = currentUrl;
        return;
    }

    // Format conversion using canvas
    const img = new Image();
    img.onload = () => {
        try {
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext('2d');
            if (targetExt === 'jpg' || targetExt === 'jpeg' || targetExt === 'bmp') {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, c.width, c.height);
            }
            ctx.drawImage(img, 0, 0);

            let mime = 'image/jpeg';
            let quality = 0.95;
            if (targetExt === 'png') { mime = 'image/png'; quality = undefined; }
            else if (targetExt === 'webp') { mime = 'image/webp'; quality = 0.95; }
            else if (targetExt === 'bmp') { mime = 'image/bmp'; quality = undefined; }
            else if (targetExt === 'gif') { mime = 'image/gif'; quality = undefined; }
            else if (targetExt === 'avif') { mime = 'image/avif'; quality = 0.95; }
            else if (targetExt === 'tiff') { mime = 'image/tiff'; quality = undefined; }

            const convertedUrl = c.toDataURL(mime, quality);
            let link = document.createElement('a');
            link.download = finalFilename;
            link.href = convertedUrl;
            link.click();
        } catch (e) {
            let link = document.createElement('a');
            link.download = finalFilename;
            link.href = currentUrl;
            link.click();
        }
        closeDownloadFilenameModal();
    };
    img.onerror = () => {
        let link = document.createElement('a');
        link.download = finalFilename;
        link.href = currentUrl;
        link.click();
        closeDownloadFilenameModal();
    };
    img.src = currentUrl;
}

function saveAsImage() { 
    let activeCanvas = getOrGenerateCroppedCanvas();
    if (!activeCanvas) {
        alert("Please load or select an image first!");
        return;
    }
    let dataUrl = activeCanvas.toDataURL('image/jpeg', 0.95);
    let defaultBase = `Monu_Computers_Scan_${activeIndex + 1}`;
    let estBytes = (dataUrl.split(',')[1] || '').length * 3 / 4;
    let estSizeStr = `~${(estBytes / 1024).toFixed(1)} KB`;
    let dimStr = `${activeCanvas.width} × ${activeCanvas.height} px`;

    triggerDownloadWithFilenameModal(dataUrl, defaultBase, 'jpg', dimStr, estSizeStr);
}

function saveAllToPDF() {
    if (imageArray.length === 0) return; 
    const { jsPDF } = window.jspdf; 
    let pdf = null;
    
    imageArray.forEach((imgObj, idx) => {
        let targetCanvas = imgObj.processedCanvas ? imgObj.processedCanvas : imgObj.element; 
        let imgData = targetCanvas.toDataURL('image/jpeg', 0.92); 
        let orientation = targetCanvas.width > targetCanvas.height ? 'l' : 'p';
        
        if (idx === 0) {
            pdf = new jsPDF(orientation, 'px', [targetCanvas.width, targetCanvas.height]); 
        } else {
            pdf.addPage([targetCanvas.width, targetCanvas.height], orientation);
        }
        pdf.addImage(imgData, 'JPEG', 0, 0, targetCanvas.width, targetCanvas.height);
    });
    
    if (pdf) {
        const arrayBuf = pdf.output('arraybuffer');
        const blob = new Blob([arrayBuf], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const defaultBase = 'Monu_Computers_Premium_Scans';
        const sizeKB = blob.size / 1024;
        const sizeStr = sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(2)} MB` : `${sizeKB.toFixed(0)} KB`;
        const dimStr = `${imageArray.length} Page${imageArray.length !== 1 ? 's' : ''}`;

        if (typeof triggerDownloadWithFilenameModal === 'function') {
            triggerDownloadWithFilenameModal(url, defaultBase, 'pdf', dimStr, sizeStr, blob);
        } else {
            pdf.save(`${defaultBase}.pdf`);
        }
    }
}

window.addEventListener('resize', () => {
    if (typeof currentMode !== 'undefined' && currentMode === 'ID') {
        drawIDPreviewComposite();
    }
});

// ═══ PRIVACY & LOCAL DATA CONTROL MANAGER ═══
window.MonuStorageManager = {
    async getStorageSummary() {
        let docCount = 0;
        let idSetCount = 0;
        let editorProjectCount = 0;
        try {
            if (window.DocIDStudioDB) {
                const docData = await window.DocIDStudioDB.get('documentData', 'session');
                if (docData && Array.isArray(docData.images)) docCount = docData.images.length;
                const idData = await window.DocIDStudioDB.get('idCardData', 'session');
                if (idData && Array.isArray(idData.bucketPairs)) idSetCount = idData.bucketPairs.length;
            }
        } catch(e) {
            console.warn('DocIDStudioDB summary read error:', e);
        }
        try {
            if (window.ImagePDFEditorDB) {
                const db = await window.ImagePDFEditorDB.init();
                const tx = db.transaction('editorProjects', 'readonly');
                const store = tx.objectStore('editorProjects');
                const req = store.getAll();
                editorProjectCount = await new Promise(r => {
                    req.onsuccess = () => r((req.result || []).length);
                    req.onerror = () => r(0);
                });
            }
        } catch(e) {
            console.warn('ImagePDFEditorDB summary read error:', e);
        }
        return { docCount, idSetCount, editorProjectCount };
    },
    async clearAllData() {
        const failures = [];

        // 1. Close open IndexedDB connections & delete databases
        try {
            if (window.DocIDStudioDB && window.DocIDStudioDB.db) {
                try { window.DocIDStudioDB.db.close(); } catch(e){}
                window.DocIDStudioDB.db = null;
            }
            if (window.ImagePDFEditorDB && window.ImagePDFEditorDB.db) {
                try { window.ImagePDFEditorDB.db.close(); } catch(e){}
                window.ImagePDFEditorDB.db = null;
            }

            const db1 = await new Promise(r => {
                const req = indexedDB.deleteDatabase('Monu_DocIDStudio_DB');
                req.onsuccess = () => r(true);
                req.onerror = () => r(false);
                req.onblocked = () => r(false);
            });
            const db2 = await new Promise(r => {
                const req = indexedDB.deleteDatabase('Monu_ImagePDFEditor_DB');
                req.onsuccess = () => r(true);
                req.onerror = () => r(false);
                req.onblocked = () => r(false);
            });
            if (!db1 || !db2) {
                failures.push('IndexedDB cache deletion');
            }
        } catch (e) {
            failures.push('IndexedDB error: ' + e.message);
        }

        // 2. Clear LocalStorage & SessionStorage
        try {
            localStorage.clear();
            sessionStorage.clear();
        } catch (e) {
            failures.push('LocalStorage/SessionStorage clear error');
        }

        // 3. Clear Service Worker Cache Storage
        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                await Promise.all(keys.map(key => caches.delete(key)));
            }
        } catch (e) {
            failures.push('Cache Storage clear error');
        }

        // 4. Clear in-memory variables and state
        try {
            imageArray = [];
            activeIndex = -1;
            bucketPairs = [];
            activeBucketIdx = -1;
            idLeftCanvas = null;
            idRightCanvas = null;
            if (typeof docStudioState !== 'undefined') {
                docStudioState.activeIndex = -1;
                docStudioState.imageArray = [];
            }
            if (typeof idStudioState !== 'undefined') {
                idStudioState.activeIndex = -1;
                idStudioState.bucketPairs = [];
                idStudioState.idLeftCanvas = null;
                idStudioState.idRightCanvas = null;
            }

            // Reset UI components and canvases
            if (typeof rebuildGalleryStrip === 'function') rebuildGalleryStrip();
            if (typeof rebuildBucketDOM === 'function') rebuildBucketDOM();
            if (typeof clearStudioCanvases === 'function') clearStudioCanvases();
            if (typeof updateButtonStates === 'function') updateButtonStates();
            if (typeof resetEditorImage === 'function') resetEditorImage();

            // Restore empty message placeholders
            const srcEmpty = document.getElementById('src-empty-msg');
            if (srcEmpty) srcEmpty.style.display = 'flex';
            const dstEmpty = document.getElementById('doc-dst-empty-msg');
            if (dstEmpty) dstEmpty.style.display = 'flex';
            const cSrc = document.getElementById('canvas-src');
            if (cSrc) cSrc.style.display = 'none';
            const cDst = document.getElementById('canvas-dst');
            if (cDst) cDst.style.display = 'none';
            const cIdDst = document.getElementById('canvas-id-dst');
            if (cIdDst) cIdDst.style.display = 'none';
        } catch (e) {
            console.warn('UI state reset note:', e);
        }

        if (failures.length === 0) {
            return {
                success: true,
                details: 'All locally stored documents, ID card sets, editor projects, LocalStorage entries, and Service Worker caches have been deleted.'
            };
        } else {
            return {
                success: false,
                details: 'Could not completely clear: ' + failures.join(', ')
            };
        }
    }
};

// ═══ CROSS-STUDIO "SEND TO" TRANSFER HELPERS ═══
function getDocStudioTransferItems(singleOnly = false) {
    if (!imageArray || imageArray.length === 0) return [];

    if (singleOnly) {
        const idx = (activeIndex >= 0 && activeIndex < imageArray.length) ? activeIndex : 0;
        const imgObj = imageArray[idx];
        let canvas = getOrGenerateCroppedCanvas();
        if (!canvas && imgObj) {
            canvas = imgObj.processedCanvas || renderRotatedOriginalToCanvas(imgObj);
        }
        if (!canvas) return [];
        const baseName = (imgObj && imgObj.name ? imgObj.name.replace(/\.[^/.]+$/, '') : `Doc_Scan_${idx + 1}`);
        return [{
            dataUrl: canvas.toDataURL('image/png'),
            name: `${baseName}_scan.png`
        }];
    }

    const items = [];
    for (let i = 0; i < imageArray.length; i++) {
        const imgObj = imageArray[i];
        let canvas = null;
        let isTemp = false;
        if (i === activeIndex) {
            canvas = getOrGenerateCroppedCanvas();
        }
        if (!canvas && imgObj.processedCanvas) {
            canvas = imgObj.processedCanvas;
        }
        if (!canvas && imgObj.element) {
            canvas = renderRotatedOriginalToCanvas(imgObj);
            isTemp = true;
        }
        if (canvas) {
            const baseName = (imgObj.name ? imgObj.name.replace(/\.[^/.]+$/, '') : `Doc_Scan_Page_${i + 1}`);
            items.push({
                dataUrl: canvas.toDataURL('image/png'),
                name: `${baseName}_p${i + 1}.png`
            });
            if (isTemp) {
                canvas.width = 1;
                canvas.height = 1;
            }
        }
    }
    return items;
}

function getIdCardStudioTransferItems() {
    const orientEl = document.getElementById('control-id-orientation');
    const orient = orientEl ? orientEl.value : 'H';
    const marksEl = document.getElementById('check-crop-marks');
    const includeBorder = marksEl ? marksEl.checked : true;

    const cardW = orient === 'V' ? 638 : 1011;
    const cardH = orient === 'V' ? 1011 : 638;
    const margin = 44;
    const gap = 44;

    if (idLeftCanvas && idRightCanvas) {
        const comp = document.createElement('canvas');
        comp.width = margin * 2 + cardW * 2 + gap;
        comp.height = margin * 2 + cardH;
        const ctx = comp.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, comp.width, comp.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        const x1 = margin;
        const x2 = margin + cardW + gap;
        const y = margin;
        ctx.drawImage(idLeftCanvas, x1, y, cardW, cardH);
        ctx.drawImage(idRightCanvas, x2, y, cardW, cardH);

        if (includeBorder) {
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2;
            ctx.strokeRect(x1, y, cardW, cardH);
            ctx.strokeRect(x2, y, cardW, cardH);
        }
        const dataUrl = comp.toDataURL('image/png');
        comp.width = 1;
        comp.height = 1;
        return [{ dataUrl, name: 'ID_Card_Front_Back.png' }];
    }

    if (idLeftCanvas || idRightCanvas) {
        const singleCanvas = idLeftCanvas || idRightCanvas;
        const comp = document.createElement('canvas');
        comp.width = margin * 2 + cardW;
        comp.height = margin * 2 + cardH;
        const ctx = comp.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, comp.width, comp.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(singleCanvas, margin, margin, cardW, cardH);
        if (includeBorder) {
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 2;
            ctx.strokeRect(margin, margin, cardW, cardH);
        }
        const dataUrl = comp.toDataURL('image/png');
        comp.width = 1;
        comp.height = 1;
        return [{ dataUrl, name: idLeftCanvas ? 'ID_Card_Front.png' : 'ID_Card_Back.png' }];
    }

    const activeCanvas = getOrGenerateCroppedCanvas();
    if (activeCanvas) {
        return [{
            dataUrl: activeCanvas.toDataURL('image/png'),
            name: 'ID_Card_Scanned.png'
        }];
    }
    return [];
}

async function sendStudioTo(studioType, destination) {
    if (typeof window.closeSendToMenu === 'function') {
        window.closeSendToMenu();
    }

    const singleOnly = (destination === 'editor');
    const items = studioType === 'id'
        ? getIdCardStudioTransferItems()
        : getDocStudioTransferItems(singleOnly);

    if (!items || items.length === 0) {
        alert(studioType === 'id'
            ? 'Please upload an ID card image or assign a Front/Back card slot first!'
            : 'Please upload or scan at least one document image first!');
        return;
    }

    const targetTool = destination === 'img2pdf'
        ? 'img2pdf'
        : (destination === 'pdfcompress' ? 'pdfcompress' : 'compress');
    const sourceLabel = studioType === 'id' ? 'ID Card Studio' : 'Document Studio';
    const payload = {
        source: sourceLabel,
        targetTool,
        items,
        timestamp: Date.now()
    };

    const hasSpaEditor = !!document.getElementById('page-editor-studio');
    if (hasSpaEditor && typeof window.receiveCrossStudioTransfer === 'function') {
        if (typeof MonuRouter !== 'undefined' && MonuRouter.navigateTo) {
            MonuRouter.navigateTo('/image-pdf-editor');
        } else if (typeof switchMode === 'function') {
            switchMode('EDITOR');
        }
        await window.receiveCrossStudioTransfer(payload);
        return;
    }

    // Multi-page route transition: persist transfer safely in IndexedDB before reload
    try {
        if (window.ImagePDFEditorDB) {
            await window.ImagePDFEditorDB.saveEditorData('pending_cross_studio_transfer', payload);
            sessionStorage.setItem('monu_pending_transfer', '1');
        }
    } catch (err) {
        console.warn('Cross-studio transfer DB persist warning:', err);
    }

    if (typeof MonuRouter !== 'undefined' && MonuRouter.navigateTo) {
        MonuRouter.navigateTo('/image-pdf-editor');
    } else {
        window.location.href = '/image-pdf-editor';
    }
}
window.sendStudioTo = sendStudioTo;


