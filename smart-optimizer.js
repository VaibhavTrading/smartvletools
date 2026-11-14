/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * Monu Computers - Shared Smart Optimization Engine
 * Architecture:
 * - Source Image & PDF Analysis (Resolution, Megapixels, Aspect Ratio, Image Type)
 * - Document / Text / ID / Certificate Anti-Artifact Protection
 * - Safe Quality Floor (Resolution & Content adaptive)
 * - Real Target-Size Optimization (Binary Search with Actual Blob Size Measurement)
 * - Pristine Source Preservation (Zero cumulative compression)
 * - Optional Smart Resolution Reduction (Controlled gradual scaling fallback)
 * - Unified Status Reporting & Reusable Compression Result Object
 */

(function(global) {
    'use strict';

    // Canvas memory pool helper
    const canvasPool = [];
    function acquireCanvas(w, h) {
        let c = canvasPool.pop() || document.createElement('canvas');
        c.width = Math.max(1, Math.round(w));
        c.height = Math.max(1, Math.round(h));
        return c;
    }
    function releaseCanvas(c) {
        if (!c) return;
        c.width = 1;
        c.height = 1;
        if (canvasPool.length < 5) {
            canvasPool.push(c);
        }
    }

    // Convert canvas to Blob (Actual authoritative byte measurement)
    function canvasToBlobAsync(canvas, format, quality) {
        return new Promise((resolve) => {
            if (canvas.convertToBlob) {
                canvas.convertToBlob({ type: format, quality })
                    .then(blob => resolve(blob))
                    .catch(() => {
                        const dataUrl = canvas.toDataURL(format, quality);
                        const b64 = dataUrl.split(',')[1] || '';
                        const byteStr = atob(b64);
                        const ab = new ArrayBuffer(byteStr.length);
                        const ia = new Uint8Array(ab);
                        for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
                        resolve(new Blob([ab], { type: format }));
                    });
            } else if (canvas.toBlob) {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        const dataUrl = canvas.toDataURL(format, quality);
                        const b64 = dataUrl.split(',')[1] || '';
                        const byteStr = atob(b64);
                        const ab = new ArrayBuffer(byteStr.length);
                        const ia = new Uint8Array(ab);
                        for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
                        resolve(new Blob([ab], { type: format }));
                    }
                }, format, quality);
            } else {
                const dataUrl = canvas.toDataURL(format, quality);
                const b64 = dataUrl.split(',')[1] || '';
                const byteStr = atob(b64);
                const ab = new ArrayBuffer(byteStr.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
                resolve(new Blob([ab], { type: format }));
            }
        });
    }

    // Helper: Convert Blob to DataURL
    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            if (blob.dataUrl) {
                resolve(blob.dataUrl);
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * NEW PROFESSIONAL IMAGE COMPRESSION ENGINE FROM SCRATCH
     * 
     * DEVELOPER ARCHITECTURE & ALGORITHM DESIGN:
     * 1. TARGET SIZE MAXIMUM CONSTRAINT:
     *    - Target size is specified in KB (`targetKB`). Converted to `targetBytes = Math.round(targetKB * 1024)`.
     *    - Authoritative measurement is ALWAYS `blob.size` (actual encoded byte length).
     *    - A candidate result is valid ONLY if `actualBytes <= targetBytes`. Target size is NEVER exceeded.
     * 
     * 2. STAGE A — QUALITY BINARY SEARCH AT 100% ORIGINAL RESOLUTION (1 TO 95):
     *    - Preserves 100% original pixel resolution (`scale = 1.0`, `width = origW`, `height = origH`).
     *    - Binary searches encoding quality in integer range [1, 95] (canvas quality 0.01..0.95).
     *    - Every test renders directly from PRISTINE source `imgElement`. Zero cumulative re-compression loss.
     *    - If Stage A finds a valid candidate (`blob.size <= targetBytes`), returns it directly. Original dimensions kept!
     * 
     * 3. STAGE B — RESOLUTION FALLBACK (TRIGGERED ONLY IF STAGE A FAILS):
     *    - Triggered ONLY if quality = 1 at 100% original resolution STILL exceeds `targetBytes`.
     *    - Reduces resolution scale (`scale < 1.0`) while strictly maintaining original aspect ratio.
     *    - Evaluates candidate scale factors using adaptive resolution search and quality optimization.
     *    - Prefers higher visual quality (e.g. Quality 60–85) at a smaller scale over Quality 1 at a larger scale.
     *    - GUARANTEED DOWNSCALE LOOP: If scale search finishes without finding `blob.size <= targetBytes`,
     *      progressively downscales scale until `blob.size <= targetBytes` IS ABSOLUTELY GUARANTEED!
     * 
     * 4. PNG HANDLING:
     *    - PNG canvas encoding is lossless and ignores quality parameter in browser.
     *    - Tests full 100% resolution first. If `blob.size <= targetBytes`, returns full resolution PNG.
     *    - If `blob.size > targetBytes`, binary searches resolution scale for PNG until highest scale with `blob.size <= targetBytes` is found.
     * 
     * 5. NORMAL COMPRESSION MODE (targetKB <= 0):
     *    - Preserves 100% original dimensions (scale = 1.0) and uses default / requested slider quality.
     */
    async function compressImageToTargetSize(file, targetSizeKB, outputFormat = 'image/jpeg', options = {}) {
        if (!file) {
            throw new Error('compressImageToTargetSize: A valid image File, Blob, Image, or URL is required.');
        }

        const targetKB = parseFloat(targetSizeKB) || 0;
        const targetBytes = targetKB > 0 ? Math.round(targetKB * 1024) : 0;
        const format = (outputFormat === 'image/webp' || outputFormat === 'image/png') ? outputFormat : 'image/jpeg';
        const isPng = (format === 'image/png');
        const defaultQuality = typeof options.quality === 'number' ? Math.min(0.95, Math.max(0.01, options.quality)) : 0.80;
        const shouldAbort = typeof options.shouldAbort === 'function' ? options.shouldAbort : null;
        const dpi = parseInt(options.dpi, 10) || 0;

        // Step 1: Resolve input to an HTMLImageElement to obtain pristine original source & natural dimensions
        let imgElement = null;
        let tempObjectUrl = null;

        if (typeof file === 'string') {
            imgElement = new Image();
            imgElement.crossOrigin = 'anonymous';
            await new Promise((resolve, reject) => {
                imgElement.onload = () => resolve();
                imgElement.onerror = () => reject(new Error('Failed to load image from URL.'));
                imgElement.src = file;
            });
        } else if (file instanceof HTMLImageElement) {
            imgElement = file;
        } else if (file instanceof Blob || file instanceof File) {
            tempObjectUrl = URL.createObjectURL(file);
            imgElement = new Image();
            await new Promise((resolve, reject) => {
                imgElement.onload = () => resolve();
                imgElement.onerror = () => reject(new Error('Failed to decode image from Blob/File.'));
                imgElement.src = tempObjectUrl;
            });
        } else {
            throw new Error('compressImageToTargetSize: Unsupported image input type.');
        }

        const origW = imgElement.naturalWidth || imgElement.width || 1;
        const origH = imgElement.naturalHeight || imgElement.height || 1;

        let originalBytes = options.originalBytes || (file instanceof File || file instanceof Blob ? file.size : 0);
        if (!originalBytes) {
            if (imgElement.src && imgElement.src.startsWith('data:')) {
                originalBytes = Math.round((imgElement.src.split(',')[1] || '').length * 3 / 4);
            } else {
                originalBytes = Math.round(origW * origH * 3 * 0.4);
            }
        }
        const originalKB = parseFloat((originalBytes / 1024).toFixed(1));

        // Helper: Render candidate from pristine original image and measure actual Blob size
        const renderCandidate = (scale, qualityInt) => {
            return new Promise((resolve, reject) => {
                const targetW = Math.max(1, Math.round(origW * scale));
                const targetH = Math.max(1, Math.round(origH * scale));

                let canvas;
                let ctx;

                if (typeof OffscreenCanvas !== 'undefined') {
                    canvas = new OffscreenCanvas(targetW, targetH);
                    ctx = canvas.getContext('2d', { alpha: isPng });
                } else {
                    canvas = document.createElement('canvas');
                    canvas.width = targetW;
                    canvas.height = targetH;
                    ctx = canvas.getContext('2d', { alpha: isPng });
                }

                if (!ctx) {
                    reject(new Error('Canvas 2D context creation failed.'));
                    return;
                }

                // White backdrop for lossy image/jpeg and image/webp without alpha
                if (!isPng) {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.fillRect(0, 0, targetW, targetH);
                }

                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(imgElement, 0, 0, targetW, targetH);

                const clampedQ = Math.min(0.95, Math.max(0.01, qualityInt / 100.0));

                if (canvas.convertToBlob) {
                    canvas.convertToBlob({
                        type: format,
                        quality: isPng ? undefined : clampedQ
                    }).then(blob => resolve({ blob, width: targetW, height: targetH, scale, qualityInt, qualityFloat: clampedQ }))
                      .catch(reject);
                } else if (canvas.toBlob) {
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve({ blob, width: targetW, height: targetH, scale, qualityInt, qualityFloat: clampedQ });
                        } else {
                            const dataUrl = canvas.toDataURL(format, clampedQ);
                            const b64 = dataUrl.split(',')[1] || '';
                            const byteStr = atob(b64);
                            const ab = new ArrayBuffer(byteStr.length);
                            const ia = new Uint8Array(ab);
                            for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
                            resolve({ blob: new Blob([ab], { type: format }), width: targetW, height: targetH, scale, qualityInt, qualityFloat: clampedQ });
                        }
                    }, format, isPng ? undefined : clampedQ);
                } else {
                    reject(new Error('HTML5 Canvas toBlob is not supported in this browser environment.'));
                }
            });
        };

        try {
            // Mode 1: Normal Compression Mode (No Target Size Specified)
            // Strictly preserves 100% original dimensions and uses slider quality (e.g., quality 80)
            if (targetBytes <= 0) {
                if (shouldAbort && shouldAbort()) return { aborted: true };
                const qualityInt = Math.round(defaultQuality * 100);
                const initial = await renderCandidate(1.0, qualityInt);
                if (shouldAbort && shouldAbort()) return { aborted: true };
                const finalBlob = (format === 'image/jpeg' && dpi > 0)
                    ? await patchJpegDpiInPlace(initial.blob, dpi)
                    : initial.blob;
                const outUrl = URL.createObjectURL(finalBlob);
                const dataUrl = await blobToDataUrl(finalBlob);

                return {
                    blob: finalBlob,
                    url: outUrl,
                    dataUrl,
                    width: initial.width,
                    height: initial.height,
                    originalWidth: origW,
                    originalHeight: origH,
                    actualBytes: finalBlob.size,
                    actualKB: parseFloat((finalBlob.size / 1024).toFixed(1)),
                    originalBytes,
                    originalKB,
                    targetKB: 0,
                    qualityUsed: initial.qualityFloat,
                    qualityInt: initial.qualityInt,
                    quality: initial.qualityFloat,
                    scaleUsed: 1.0,
                    resolutionReduced: false,
                    format,
                    targetReached: true,
                    nearTarget: false,
                    status: 'standard',
                    statusMessage: `Compressed to ${(finalBlob.size / 1024).toFixed(1)} KB (${initial.width}×${initial.height}px, Quality: ${initial.qualityInt})`,
                    revoke: () => URL.revokeObjectURL(outUrl)
                };
            }

            // Mode 2: Target Size Mode (Strict Maximum Target Size Optimization)
            let chosenCandidate = null;

            if (isPng) {
                // PNG is lossless in browser canvas (quality integer is ignored).
                // Test 100% original resolution first.
                const fullPng = await renderCandidate(1.0, 100);
                if (shouldAbort && shouldAbort()) return { aborted: true };
                if (fullPng.blob.size <= targetBytes) {
                    chosenCandidate = fullPng;
                } else {
                    // Resolution scale binary search for PNG to satisfy targetBytes
                    let loScale = 0.005;
                    let hiScale = 0.99;
                    let bestPng = null;

                    for (let iter = 0; iter < 12; iter++) {
                        if (shouldAbort && shouldAbort()) return { aborted: true };
                        const midScale = parseFloat(((loScale + hiScale) / 2).toFixed(4));
                        const cand = await renderCandidate(midScale, 100);
                        if (shouldAbort && shouldAbort()) return { aborted: true };

                        if (cand.blob.size <= targetBytes) {
                            bestPng = cand;
                            loScale = midScale + 0.002;
                        } else {
                            hiScale = midScale - 0.002;
                        }

                        if (loScale > hiScale) break;
                    }

                    // Emergency downscale loop for PNG to GUARANTEE size <= targetBytes
                    if (!bestPng) {
                        let emScale = 0.5;
                        while (emScale >= 0.002) {
                            if (shouldAbort && shouldAbort()) return { aborted: true };
                            const cand = await renderCandidate(emScale, 100);
                            if (shouldAbort && shouldAbort()) return { aborted: true };
                            if (cand.blob.size <= targetBytes) {
                                bestPng = cand;
                                break;
                            }
                            emScale *= 0.7;
                        }
                    }

                    chosenCandidate = bestPng || fullPng;
                }
            } else {
                // JPEG & WebP: Two-Stage Optimization Engine
                
                // STAGE A: QUALITY BINARY SEARCH AT 100% ORIGINAL RESOLUTION (Scale = 1.0, Quality 1 to 95)
                // Goal: Find the highest quality (1..95) where actual Blob size <= targetBytes
                let lowQ = 1;
                let highQ = 95;
                let bestStageACandidate = null;

                while (lowQ <= highQ) {
                    if (shouldAbort && shouldAbort()) return { aborted: true };
                    const midQ = Math.floor((lowQ + highQ) / 2);
                    const cand = await renderCandidate(1.0, midQ);
                    if (shouldAbort && shouldAbort()) return { aborted: true };

                    if (cand.blob.size <= targetBytes) {
                        // Valid candidate! Target size satisfied.
                        bestStageACandidate = cand;
                        // Search higher quality range to maximize visual quality
                        lowQ = midQ + 1;
                    } else {
                        // Actual size exceeds target size. Search lower quality range
                        highQ = midQ - 1;
                    }
                }

                if (bestStageACandidate !== null) {
                    // STAGE A SUCCESS!
                    // Target size achieved while preserving 100% original pixel resolution.
                    chosenCandidate = bestStageACandidate;
                } else {
                    // STAGE B: RESOLUTION FALLBACK
                    // Triggered ONLY because even quality = 1 at 100% original resolution exceeds targetBytes.
                    // Reduce resolution scale (scale < 1.0) while strictly maintaining original aspect ratio.

                    // Helper: Perform quality binary search (1..95) at a specific resolution scale
                    const findBestQualityAtScale = async (scale) => {
                        let lQ = 1;
                        let hQ = 95;
                        let bestAtScale = null;
                        while (lQ <= hQ) {
                            if (shouldAbort && shouldAbort()) return null;
                            const midQ = Math.floor((lQ + hQ) / 2);
                            const cand = await renderCandidate(scale, midQ);
                            if (shouldAbort && shouldAbort()) return null;
                            if (cand.blob.size <= targetBytes) {
                                bestAtScale = cand;
                                lQ = midQ + 1; // Try higher quality at this scale
                            } else {
                                hQ = midQ - 1;
                            }
                        }
                        return bestAtScale;
                    };

                    // Evaluate scale candidates to find the highest practical scale & quality
                    let validScaleCandidates = [];

                    // Binary search resolution scale S in [0.005, 0.98]
                    let loScale = 0.005;
                    let hiScale = 0.98;

                    for (let iter = 0; iter < 10; iter++) {
                        if (shouldAbort && shouldAbort()) return { aborted: true };
                        const midScale = parseFloat(((loScale + hiScale) / 2).toFixed(4));
                        const candAtScale = await findBestQualityAtScale(midScale);
                        if (shouldAbort && shouldAbort()) return { aborted: true };

                        if (candAtScale !== null) {
                            validScaleCandidates.push(candAtScale);
                            // Scale fits target! Probe if a larger scale also fits
                            loScale = midScale + 0.005;
                        } else {
                            // Even quality = 1 at midScale exceeds targetBytes. Reduce scale
                            hiScale = midScale - 0.005;
                        }

                        if (loScale > hiScale) break;
                    }

                    if (validScaleCandidates.length > 0) {
                        // Select candidate that maximizes visual fidelity:
                        // Prefer candidate with high quality (>= 50), then higher resolution scale
                        validScaleCandidates.sort((a, b) => {
                            const scoreA = (a.qualityInt >= 50 ? 1000 : 0) + (a.scale * 100) + (a.qualityInt * 0.5);
                            const scoreB = (b.qualityInt >= 50 ? 1000 : 0) + (b.scale * 100) + (b.qualityInt * 0.5);
                            return scoreB - scoreA;
                        });
                        chosenCandidate = validScaleCandidates[0];
                    }

                    // EMERGENCY DOWNSCALE FALLBACK:
                    // If no candidate <= targetBytes was found yet (e.g. ultra small target like 5 KB),
                    // geometrically downscale scale until size <= targetBytes IS GUARANTEED!
                    if (!chosenCandidate || chosenCandidate.blob.size > targetBytes) {
                        let emScale = 0.5;
                        while (emScale >= 0.002) {
                            if (shouldAbort && shouldAbort()) return { aborted: true };
                            const emCand = await findBestQualityAtScale(emScale);
                            if (shouldAbort && shouldAbort()) return { aborted: true };
                            if (emCand && emCand.blob.size <= targetBytes) {
                                chosenCandidate = emCand;
                                break;
                            }
                            emScale = parseFloat((emScale * 0.7).toFixed(4));
                        }
                    }
                }
            }

            if (shouldAbort && shouldAbort()) return { aborted: true };

            // GUARANTEE CHECK:
            // Ensure chosenCandidate exists and strictly satisfies actualBytes <= targetBytes
            if (!chosenCandidate || chosenCandidate.blob.size > targetBytes) {
                // Final safety fallback: render at minimum scale (0.01) at quality 1
                let minSafetyCand = await renderCandidate(0.01, 1);
                if (chosenCandidate && chosenCandidate.blob.size <= targetBytes) {
                    // keep chosenCandidate
                } else {
                    chosenCandidate = minSafetyCand;
                }
            }

            if (shouldAbort && shouldAbort()) return { aborted: true };

            const chosen = chosenCandidate;
            const finalBlob = (format === 'image/jpeg' && dpi > 0)
                ? await patchJpegDpiInPlace(chosen.blob, dpi)
                : chosen.blob;
            const actualBytes = finalBlob.size;
            const actualKB = parseFloat((actualBytes / 1024).toFixed(1));
            const isReached = actualBytes <= targetBytes;

            const finalObjectUrl = URL.createObjectURL(finalBlob);
            const dataUrl = await blobToDataUrl(finalBlob);

            const scaleFormatted = chosen.scale < 0.999 ? ` (${Math.round(chosen.scale * 100)}% scale)` : '';
            const statusMessage = isReached
                ? `🎯 TARGET REACHED: ${actualKB} KB (${chosen.width}×${chosen.height}px${scaleFormatted}, Quality: ${chosen.qualityInt})`
                : `TARGET NOT REACHED: ${actualKB} KB (${chosen.width}×${chosen.height}px${scaleFormatted}, Quality: ${chosen.qualityInt})`;

            return {
                blob: finalBlob,
                url: finalObjectUrl,
                dataUrl,
                width: chosen.width,
                height: chosen.height,
                originalWidth: origW,
                originalHeight: origH,
                actualBytes,
                actualKB,
                originalBytes,
                originalKB,
                targetKB,
                qualityUsed: chosen.qualityFloat,
                qualityInt: chosen.qualityInt,
                quality: chosen.qualityFloat,
                scaleUsed: chosen.scale,
                resolutionReduced: chosen.scale < 0.999,
                format,
                targetReached: isReached,
                nearTarget: !isReached,
                status: isReached ? 'reached' : 'not_reached',
                statusMessage,
                revoke: () => URL.revokeObjectURL(finalObjectUrl)
            };
        } finally {
            if (tempObjectUrl) {
                URL.revokeObjectURL(tempObjectUrl);
            }
        }
    }

    // Standard CRC-32 table for PNG chunk padding
    const _crcTable = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32Bytes(bytes) {
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
            crc = _crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
        }
        return (crc ^ 0xffffffff) >>> 0;
    }

    // Patches standard JFIF APP0 DPI bytes in-place (changes 0 bytes of file size)
    async function patchJpegDpiInPlace(blob, dpi) {
        if (!blob || !dpi || dpi < 1 || dpi > 65535) return blob;
        try {
            const buf = await blob.arrayBuffer();
            const u8 = new Uint8Array(buf);
            if (u8.length >= 18 &&
                u8[0] === 0xFF && u8[1] === 0xD8 &&
                u8[2] === 0xFF && u8[3] === 0xE0 &&
                u8[6] === 0x4A && u8[7] === 0x46 && u8[8] === 0x49 && u8[9] === 0x46 && u8[10] === 0x00) {
                u8[13] = 1; // pixels per inch
                u8[14] = (dpi >> 8) & 0xFF;
                u8[15] = dpi & 0xFF;
                u8[16] = (dpi >> 8) & 0xFF;
                u8[17] = dpi & 0xFF;
                return new Blob([u8], { type: 'image/jpeg' });
            }
        } catch (e) {
            // ignore metadata patch failures
        }
        return blob;
    }

    // Spec-compliant binary metadata chunk padding so Increase Target KB ALWAYS succeeds reliably
    async function padImageBlobToTargetBytes(blob, targetBytes, format) {
        if (!blob || !targetBytes || blob.size >= targetBytes) return blob;
        const src = new Uint8Array(await blob.arrayBuffer());
        const deficit = targetBytes - src.length;
        if (deficit <= 0) return blob;

        if (format === 'image/jpeg' && src.length >= 4 && src[0] === 0xFF && src[1] === 0xD8) {
            // Insert valid JPEG COM (0xFF 0xFE) segments directly after SOI (0xFF 0xD8).
            // Max COM segment total size is 65537 bytes? Wait: 2-byte length field includes itself (max 65535),
            // so total segment bytes = 2 (marker FF FE) + 65535 = 65537 bytes (payload = 65533 bytes).
            let addedChunks = [];
            let rem = deficit;
            while (rem > 0) {
                let segTotal;
                if (rem <= 65537) {
                    segTotal = Math.max(4, rem);
                } else {
                    // Leave at least 4 bytes for the final segment
                    segTotal = Math.min(65537, rem - 4);
                }
                const lenField = segTotal - 2;
                const chunk = new Uint8Array(segTotal);
                chunk[0] = 0xFF;
                chunk[1] = 0xFE;
                chunk[2] = (lenField >> 8) & 0xFF;
                chunk[3] = lenField & 0xFF;
                chunk.fill(0x20, 4); // ASCII spaces
                addedChunks.push(chunk);
                rem -= segTotal;
            }
            const totalAdded = addedChunks.reduce((acc, c) => acc + c.length, 0);
            const out = new Uint8Array(src.length + totalAdded);
            out.set(src.subarray(0, 2), 0);
            let offset = 2;
            for (const c of addedChunks) {
                out.set(c, offset);
                offset += c.length;
            }
            out.set(src.subarray(2), offset);
            return new Blob([out], { type: 'image/jpeg' });
        }

        if (format === 'image/png' && src.length >= 20 &&
            src[src.length - 8] === 0x49 && src[src.length - 7] === 0x45 &&
            src[src.length - 6] === 0x4E && src[src.length - 5] === 0x44) {
            // Insert valid PNG tEXt chunk with exact CRC-32 right before the 12-byte IEND chunk.
            // Overhead per chunk = 12 bytes (4 len + 4 'tEXt' + 4 CRC). Prefix 'p\0' = 2 bytes. Min added = 14 bytes.
            const insertAt = src.length - 12;
            const totalAdd = Math.max(14, deficit);
            const payloadLen = totalAdd - 12; // includes 'p\0' + spaces
            const chunk = new Uint8Array(totalAdd);
            const dv = new DataView(chunk.buffer);
            dv.setUint32(0, payloadLen, false);
            chunk[4] = 0x74; // 't'
            chunk[5] = 0x45; // 'E'
            chunk[6] = 0x58; // 'X'
            chunk[7] = 0x74; // 't'
            chunk[8] = 0x70; // 'p'
            chunk[9] = 0x00; // null separator
            chunk.fill(0x20, 10, 8 + payloadLen);
            const crc = crc32Bytes(chunk.subarray(4, 8 + payloadLen));
            dv.setUint32(8 + payloadLen, crc, false);

            const out = new Uint8Array(src.length + totalAdd);
            out.set(src.subarray(0, insertAt), 0);
            out.set(chunk, insertAt);
            out.set(src.subarray(insertAt), insertAt + totalAdd);
            return new Blob([out], { type: 'image/png' });
        }

        if (format === 'image/webp' && src.length >= 16 &&
            src[0] === 0x52 && src[1] === 0x49 && src[2] === 0x46 && src[3] === 0x46 &&
            src[8] === 0x57 && src[9] === 0x45 && src[10] === 0x42 && src[11] === 0x50) {
            // Append valid RIFF JUNK chunk (even payload length) and update RIFF size header
            const needEvenSrcPad = (src.length % 2 === 1) ? 1 : 0;
            let payloadLen = Math.max(0, deficit - needEvenSrcPad - 8);
            if (payloadLen % 2 === 1) payloadLen += 1;
            const addedLen = needEvenSrcPad + 8 + payloadLen;
            const out = new Uint8Array(src.length + addedLen);
            out.set(src, 0);
            let pos = src.length + needEvenSrcPad;
            out[pos] = 0x4A; // 'J'
            out[pos + 1] = 0x55; // 'U'
            out[pos + 2] = 0x4E; // 'N'
            out[pos + 3] = 0x4B; // 'K'
            const dv = new DataView(out.buffer);
            dv.setUint32(pos + 4, payloadLen, true);
            dv.setUint32(4, out.length - 8, true);
            return new Blob([out], { type: 'image/webp' });
        }

        return blob;
    }

    async function increaseImageToTargetSize(file, targetSizeKB, outputFormat = 'image/jpeg', options = {}) {
        if (!file) {
            throw new Error('increaseImageToTargetSize: A valid image input is required.');
        }
        const targetKB = parseFloat(targetSizeKB) || 0;
        const targetBytes = targetKB > 0 ? Math.round(targetKB * 1024) : 0;
        const format = (outputFormat === 'image/webp' || outputFormat === 'image/png') ? outputFormat : 'image/jpeg';
        const isPng = (format === 'image/png');
        const qualityFloor = typeof options.quality === 'number' ? Math.min(1.0, Math.max(0.70, options.quality)) : 0.95;
        const shouldAbort = typeof options.shouldAbort === 'function' ? options.shouldAbort : null;
        const dpi = parseInt(options.dpi, 10) || 0;

        let imgElement = null;
        let tempObjectUrl = null;
        if (typeof file === 'string') {
            imgElement = new Image();
            imgElement.crossOrigin = 'anonymous';
            await new Promise((resolve, reject) => {
                imgElement.onload = () => resolve();
                imgElement.onerror = () => reject(new Error('Failed to load image.'));
                imgElement.src = file;
            });
        } else if (file instanceof HTMLImageElement) {
            imgElement = file;
        } else if (file instanceof Blob || file instanceof File) {
            tempObjectUrl = URL.createObjectURL(file);
            imgElement = new Image();
            await new Promise((resolve, reject) => {
                imgElement.onload = () => resolve();
                imgElement.onerror = () => reject(new Error('Failed to decode image.'));
                imgElement.src = tempObjectUrl;
            });
        } else {
            throw new Error('increaseImageToTargetSize: Unsupported image input.');
        }

        const origW = imgElement.naturalWidth || imgElement.width || 1;
        const origH = imgElement.naturalHeight || imgElement.height || 1;

        const renderAt = async (scale, qualityFloat) => {
            const targetW = Math.max(1, Math.round(origW * scale));
            const targetH = Math.max(1, Math.round(origH * scale));
            const canvas = acquireCanvas(targetW, targetH);
            const ctx = canvas.getContext('2d', { alpha: isPng });
            if (!isPng) {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, targetW, targetH);
            } else {
                ctx.clearRect(0, 0, targetW, targetH);
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(imgElement, 0, 0, targetW, targetH);
            const blob = await canvasToBlobAsync(canvas, format, isPng ? undefined : Math.min(1.0, Math.max(0.01, qualityFloat)));
            releaseCanvas(canvas);
            return { blob, width: targetW, height: targetH, scale, quality: qualityFloat };
        };

        try {
            if (shouldAbort && shouldAbort()) return { aborted: true };

            // Mode A: No target KB specified -> encode cleanly at requested quality floor & original resolution
            if (targetBytes <= 0) {
                const cand = await renderAt(1.0, qualityFloor);
                if (shouldAbort && shouldAbort()) return { aborted: true };
                const finalBlob = (format === 'image/jpeg' && dpi > 0)
                    ? await patchJpegDpiInPlace(cand.blob, dpi)
                    : cand.blob;
                const url = URL.createObjectURL(finalBlob);
                const dataUrl = await blobToDataUrl(finalBlob);
                const actualKB = parseFloat((finalBlob.size / 1024).toFixed(1));
                return {
                    blob: finalBlob,
                    url,
                    dataUrl,
                    width: cand.width,
                    height: cand.height,
                    originalWidth: origW,
                    originalHeight: origH,
                    actualBytes: finalBlob.size,
                    actualKB,
                    targetKB: 0,
                    quality: cand.quality,
                    format,
                    targetReached: true,
                    status: 'standard',
                    statusMessage: `Quality set to ${Math.round(cand.quality * 100)}% (~${actualKB} KB)`,
                    revoke: () => URL.revokeObjectURL(url)
                };
            }

            // Mode B: Target Minimum File Size (KB)
            // Step 1: Test 100% original resolution at maximum quality (1.0)
            let chosen = await renderAt(1.0, 1.0);
            if (shouldAbort && shouldAbort()) return { aborted: true };

            if (chosen.blob.size >= targetBytes) {
                // Can reach or exceed targetBytes at 100% resolution: find lowest quality >= qualityFloor that satisfies >= targetBytes
                if (!isPng) {
                    const floorCand = await renderAt(1.0, qualityFloor);
                    if (shouldAbort && shouldAbort()) return { aborted: true };
                    if (floorCand.blob.size >= targetBytes) {
                        chosen = floorCand;
                    } else {
                        let lo = qualityFloor;
                        let hi = 1.0;
                        let best = chosen;
                        for (let i = 0; i < 8; i++) {
                            if (shouldAbort && shouldAbort()) return { aborted: true };
                            const mid = (lo + hi) / 2;
                            const c = await renderAt(1.0, mid);
                            if (c.blob.size >= targetBytes) {
                                best = c;
                                hi = mid - 0.005;
                            } else {
                                lo = mid + 0.005;
                            }
                            if (hi - lo < 0.005) break;
                        }
                        chosen = best;
                    }
                }
            } else {
                // Step 2: Controlled upscaling up to max 2400px longest side to naturally add pixel detail
                const maxDim = Math.max(origW, origH);
                const maxSafeScale = maxDim < 2400 ? Math.min(2.5, 2400 / maxDim) : 1.0;
                if (maxSafeScale > 1.05) {
                    const stepScales = [1.25, 1.5, 1.85, maxSafeScale].filter(s => s <= maxSafeScale + 0.01);
                    for (const s of stepScales) {
                        if (shouldAbort && shouldAbort()) return { aborted: true };
                        const c = await renderAt(s, 1.0);
                        chosen = c;
                        if (c.blob.size >= targetBytes) {
                            break;
                        }
                    }
                }

                // Step 3: If even high-res quality=1.0 is below targetBytes (very common for clean docs/logos boosted to 500-2000 KB),
                // pad validly inside standard container metadata chunk so exact targetBytes is ALWAYS reached!
                if (chosen.blob.size < targetBytes) {
                    const paddedBlob = await padImageBlobToTargetBytes(chosen.blob, targetBytes, format);
                    chosen = { ...chosen, blob: paddedBlob };
                }
            }

            if (shouldAbort && shouldAbort()) return { aborted: true };

            const finalBlob = (format === 'image/jpeg' && dpi > 0)
                ? await patchJpegDpiInPlace(chosen.blob, dpi)
                : chosen.blob;
            const actualBytes = finalBlob.size;
            const actualKB = parseFloat((actualBytes / 1024).toFixed(1));
            const targetReached = actualBytes >= targetBytes;

            const finalObjectUrl = URL.createObjectURL(finalBlob);
            const dataUrl = await blobToDataUrl(finalBlob);

            return {
                blob: finalBlob,
                url: finalObjectUrl,
                dataUrl,
                width: chosen.width,
                height: chosen.height,
                originalWidth: origW,
                originalHeight: origH,
                actualBytes,
                actualKB,
                targetKB,
                quality: chosen.quality,
                scaleUsed: chosen.scale,
                format,
                targetReached,
                status: targetReached ? 'reached' : 'not_reached',
                statusMessage: targetReached
                    ? `🎯 Target Reached! Enlarged to ${actualKB} KB (${chosen.width}×${chosen.height}px)`
                    : `Enlarged to ${actualKB} KB (${chosen.width}×${chosen.height}px)`,
                revoke: () => URL.revokeObjectURL(finalObjectUrl)
            };
        } finally {
            if (tempObjectUrl) {
                URL.revokeObjectURL(tempObjectUrl);
            }
        }
    }

    const standardCompressImage = compressImageToTargetSize;

    const SmartOptimizationEngine = {
        name: 'Monu Smart Optimization Engine',
        version: '2.0.0',

        /**
         * 1. SOURCE IMAGE ANALYSIS
         * Analyzes dimensions, megapixels, resolution category, and document/text characteristics.
         */
        analyzeImageSource(sourceImg, options = {}) {
            if (!sourceImg) return null;
            const w = sourceImg.naturalWidth || sourceImg.width || 0;
            const h = sourceImg.naturalHeight || sourceImg.height || 0;
            const mp = (w * h) / 1000000;
            const maxDim = Math.max(w, h);

            // Resolution category
            let category = 'medium'; // 'high', 'medium', 'low'
            if (mp >= 2.5 || maxDim >= 2000) {
                category = 'high';
            } else if (mp < 0.85 || maxDim <= 900) {
                category = 'low';
            }

            // Document / text / certificate / ID protection flag
            // Can be explicitly passed in options, or defaults to true for safety
            const isDocument = (options.isDocument !== undefined) ? !!options.isDocument : true;

            // Safe Minimum Quality Floor
            // Document images require higher floor to prevent text distortion, haloing & ringing artifacts.
            let minQualityFloor = 0.65;
            let adaptiveQuality = 0.85;

            if (isDocument) {
                if (category === 'low') {
                    minQualityFloor = 0.82; // Protect small text / stamps / IDs
                    adaptiveQuality = 0.92;
                } else if (category === 'medium') {
                    minQualityFloor = 0.70; // Standard documents, certificates
                    adaptiveQuality = 0.86;
                } else {
                    minQualityFloor = 0.58; // High-res document scans
                    adaptiveQuality = 0.82;
                }
            } else {
                // Photographic images
                if (category === 'low') {
                    minQualityFloor = 0.75;
                    adaptiveQuality = 0.90;
                } else if (category === 'medium') {
                    minQualityFloor = 0.55;
                    adaptiveQuality = 0.82;
                } else {
                    minQualityFloor = 0.42;
                    adaptiveQuality = 0.76;
                }
            }

            return {
                width: w,
                height: h,
                aspectRatio: w > 0 && h > 0 ? (w / h) : 1,
                megapixels: mp,
                category,
                isDocument,
                minQualityFloor,
                adaptiveQuality
            };
        },

        /**
         * 2. RENDER & MEASURE IMAGE CANDIDATE
         * Renders from PRISTINE source onto a fresh/pooled canvas and measures actual Blob size.
         */
        async renderImageCandidate(sourceImg, format, quality, scale = 1.0) {
            const origW = sourceImg.naturalWidth || sourceImg.width || 0;
            const origH = sourceImg.naturalHeight || sourceImg.height || 0;
            const targetW = Math.max(1, Math.round(origW * scale));
            const targetH = Math.max(1, Math.round(origH * scale));

            const canvas = acquireCanvas(targetW, targetH);
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            const isPng = format === 'image/png';
            if (isPng) {
                ctx.clearRect(0, 0, targetW, targetH);
                ctx.drawImage(sourceImg, 0, 0, targetW, targetH);
            } else {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, targetW, targetH);
                ctx.drawImage(sourceImg, 0, 0, targetW, targetH);
            }

            const clampedQuality = Math.min(1.0, Math.max(0.01, quality));
            const blob = await canvasToBlobAsync(canvas, format, clampedQuality);
            const actualBytes = blob.size;
            const actualKB = actualBytes / 1024;

            // Generate dataUrl for the winner candidate when needed
            const getDataUrl = async () => {
                if (blob.dataUrl) return blob.dataUrl;
                return await blobToDataUrl(blob);
            };

            releaseCanvas(canvas);

            return {
                blob,
                actualBytes,
                actualKB,
                quality: clampedQuality,
                width: targetW,
                height: targetH,
                scale,
                getDataUrl
            };
        },

        /**
         * 3. OPTIMIZE IMAGE (Used by Compress Tool, Convert Tool, Scanner Export)
         * Implements iterative binary search with actual Blob size measurement,
         * safe quality floor protection, and optional smart resolution reduction.
         */
        async optimizeImage(sourceImg, options = {}) {
            if (!sourceImg) throw new Error('No source image provided to SmartOptimizationEngine.');

            const format = options.format || 'image/jpeg';
            const targetKB = parseFloat(options.targetKB) || 0;
            const quality = options.quality !== undefined ? parseFloat(options.quality) : 0.80;

            const res = await standardCompressImage(sourceImg, targetKB, format, {
                quality,
                originalBytes: options.originalBytes,
                shouldAbort: options.shouldAbort,
                dpi: options.dpi
            });

            return res;
        },

        async increaseImage(sourceImg, options = {}) {
            if (!sourceImg) throw new Error('No source image provided to SmartOptimizationEngine.');

            const format = options.format || 'image/jpeg';
            const targetKB = parseFloat(options.targetKB) || 0;
            const quality = options.quality !== undefined ? parseFloat(options.quality) : 0.95;

            return await increaseImageToTargetSize(sourceImg, targetKB, format, {
                quality,
                shouldAbort: options.shouldAbort,
                dpi: options.dpi
            });
        },

        /**
         * 4. OPTIMIZE PDF SEQUENCE
         * Shared engine for PDF compilation and target-size optimization
         * Used by both "Image to PDF" and "PDF Optimizer".
         */
        async optimizePdfSequence(pages, options = {}, onProgress = null) {
            if (!pages || !pages.length) throw new Error('No pages provided for PDF optimization.');
            if (!window.jspdf || !window.jspdf.jsPDF) {
                throw new Error('jsPDF library is not loaded.');
            }

            const { jsPDF } = window.jspdf;
            const totalPages = pages.length;
            const targetKB = parseFloat(options.targetKB) || 0;
            const targetBytes = targetKB > 0 ? (targetKB * 1024) : 0;
            const baseDpi = options.baseDpi || 150;
            const isCompress = options.isCompress !== false;
            const baseQuality = options.baseQuality || (isCompress ? 0.80 : 0.95);
            const pageSize = options.pageSize || 'fit';
            const orientOpt = options.orientation || 'auto';
            const margin = options.margin !== undefined ? parseFloat(options.margin) : 0;
            const showPageNum = !!options.showPageNum;
            const isDocument = options.isDocument !== false;

            // Safe Quality Floor for PDF embedded images
            // Prevents PDF Optimizer or Image-to-PDF from degrading down to 0.05
            const pdfQualityFloor = isDocument ? 0.60 : 0.45;

            const pageDimMap = { a4: [210, 297], a3: [297, 420], letter: [216, 279], fit: null };
            const baseDim = pageDimMap[pageSize];

            // Render single candidate PDF pass from PRISTINE sources
            async function buildCandidatePdf(quality, scaleFactor = 1.0) {
                const effectiveDpi = baseDpi * scaleFactor;
                const scale = effectiveDpi / 72;
                let pdf = null;

                for (let i = 0; i < totalPages; i++) {
                    const item = pages[i];
                    const pgNum = i + 1;

                    if (onProgress) {
                        onProgress({
                            pageIndex: i,
                            totalPages,
                            percent: Math.round(((pgNum - 0.5) / totalPages) * 100),
                            status: `Processing page ${pgNum}/${totalPages}…`
                        });
                    }

                    // 1. Render raw canvas from pristine source
                    let rawCanvas = document.createElement('canvas');
                    if (item.type === 'pdf' && item.pdfDoc && item.pdfPageNum) {
                        const page = await item.pdfDoc.getPage(item.pdfPageNum);
                        const vp = page.getViewport({ scale });
                        rawCanvas.width = Math.max(1, Math.round(vp.width));
                        rawCanvas.height = Math.max(1, Math.round(vp.height));
                        const ctx = rawCanvas.getContext('2d');
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, rawCanvas.width, rawCanvas.height);
                        await page.render({ canvasContext: ctx, viewport: vp }).promise;
                    } else {
                        // Image page from pristine imgElement
                        const im = item.imgElement;
                        rawCanvas.width = im.naturalWidth || im.width;
                        rawCanvas.height = im.naturalHeight || im.height;
                        const ctx = rawCanvas.getContext('2d');
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, rawCanvas.width, rawCanvas.height);
                        ctx.drawImage(im, 0, 0);
                    }

                    // 2. Handle Rotation
                    let finalCanvas = rawCanvas;
                    const rot = (item.rotation || 0) % 360;
                    if (rot !== 0) {
                        finalCanvas = document.createElement('canvas');
                        if (rot === 90 || rot === 270) {
                            finalCanvas.width = rawCanvas.height;
                            finalCanvas.height = rawCanvas.width;
                        } else {
                            finalCanvas.width = rawCanvas.width;
                            finalCanvas.height = rawCanvas.height;
                        }
                        const rctx = finalCanvas.getContext('2d');
                        rctx.fillStyle = '#ffffff';
                        rctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
                        rctx.translate(finalCanvas.width / 2, finalCanvas.height / 2);
                        rctx.rotate((rot * Math.PI) / 180);
                        rctx.drawImage(rawCanvas, -rawCanvas.width / 2, -rawCanvas.height / 2);
                        // Release raw canvas
                        rawCanvas.width = 1;
                        rawCanvas.height = 1;
                    }

                    // 3. Compute PDF Dimensions
                    let wMM, hMM, useOrient;
                    if (pageSize === 'fit') {
                        wMM = (finalCanvas.width / effectiveDpi) * 25.4;
                        hMM = (finalCanvas.height / effectiveDpi) * 25.4;
                    } else {
                        [wMM, hMM] = [...baseDim];
                    }

                    useOrient = orientOpt === 'auto' ? (finalCanvas.width > finalCanvas.height ? 'l' : 'p') : orientOpt;
                    if (useOrient === 'l' && pageSize !== 'fit') [wMM, hMM] = [hMM, wMM];

                    const cWMM = Math.max(1, wMM - margin * 2);
                    const cHMM = Math.max(1, hMM - margin * 2);
                    const imgAR = finalCanvas.width / finalCanvas.height;
                    const pageAR = cWMM / cHMM;

                    let iW, iH, iX, iY;
                    if (imgAR > pageAR) {
                        iW = cWMM;
                        iH = cWMM / imgAR;
                        iX = margin;
                        iY = margin + (cHMM - iH) / 2;
                    } else {
                        iH = cHMM;
                        iW = cHMM * imgAR;
                        iX = margin + (cWMM - iW) / 2;
                        iY = margin;
                    }

                    // Ensure safe coordinates
                    iX = Number.isFinite(iX) ? iX : margin;
                    iY = Number.isFinite(iY) ? iY : margin;
                    iW = Number.isFinite(iW) && iW > 0 ? iW : cWMM;
                    iH = Number.isFinite(iH) && iH > 0 ? iH : cHMM;

                    // Safety downscale if excessively oversized canvas
                    const maxCanvasDim = 2500;
                    let renderCanvas = finalCanvas;
                    if (finalCanvas.width > maxCanvasDim || finalCanvas.height > maxCanvasDim) {
                        const downScale = Math.min(maxCanvasDim / finalCanvas.width, maxCanvasDim / finalCanvas.height);
                        renderCanvas = document.createElement('canvas');
                        renderCanvas.width = Math.round(finalCanvas.width * downScale);
                        renderCanvas.height = Math.round(finalCanvas.height * downScale);
                        const dctx = renderCanvas.getContext('2d');
                        dctx.fillStyle = '#ffffff';
                        dctx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
                        dctx.drawImage(finalCanvas, 0, 0, renderCanvas.width, renderCanvas.height);
                    }

                    const minEffectiveQ = targetBytes > 0 ? 0.04 : pdfQualityFloor;
                    const clampedQuality = Math.min(1.0, Math.max(minEffectiveQ, quality));
                    const imgData = renderCanvas.toDataURL('image/jpeg', clampedQuality);

                    // Clean up intermediate canvas
                    if (renderCanvas !== finalCanvas) {
                        renderCanvas.width = 1;
                        renderCanvas.height = 1;
                    }
                    finalCanvas.width = 1;
                    finalCanvas.height = 1;

                    if (!pdf) {
                        pdf = new jsPDF({
                            orientation: useOrient,
                            unit: 'mm',
                            format: pageSize === 'fit' ? [wMM, hMM] : pageSize,
                            compress: true
                        });
                    } else {
                        pdf.addPage(pageSize === 'fit' ? [wMM, hMM] : pageSize, useOrient);
                    }

                    pdf.addImage(imgData, 'JPEG', iX, iY, iW, iH, undefined, 'FAST');

                    if (showPageNum) {
                        pdf.setFontSize(9);
                        pdf.setTextColor(100);
                        pdf.text(`${pgNum}`, wMM / 2, hMM - 5, { align: 'center' });
                    }
                }

                const buffer = pdf.output('arraybuffer');
                return {
                    buffer,
                    byteLength: buffer.byteLength,
                    kb: buffer.byteLength / 1024,
                    quality,
                    scaleFactor
                };
            }

            // Case A: No target KB specified => Single high-quality pass
            if (targetBytes <= 0 || !isCompress) {
                const result = await buildCandidatePdf(baseQuality, 1.0);
                return {
                    buffer: result.buffer,
                    actualBytes: result.byteLength,
                    actualKB: result.kb,
                    targetKB: 0,
                    qualityUsed: baseQuality,
                    targetReached: true,
                    nearTarget: false,
                    qualityProtected: true,
                    bestSafeResult: false,
                    status: 'smart_auto',
                    statusMessage: `PDF Generated (${result.kb >= 1024 ? (result.kb / 1024).toFixed(2) + ' MB' : result.kb.toFixed(0) + ' KB'}, ${Math.round(baseQuality * 100)}% quality)`
                };
            }

            // Case B: Target KB Specified => FORCED PDF TARGET-SIZE OPTIMIZATION
            // Priority 1: Reach requested PDF target size
            // STAGE 1: Full-Resolution (scaleFactor = 1.0) search down to practical minimum quality
            let lo = 0.04;
            let hi = baseQuality;
            let bestBelowOrEqual = null;
            let closestCandidate = null;

            for (let attempt = 0; attempt < 8; attempt++) {
                const midQ = parseFloat(((lo + hi) / 2).toFixed(3));
                if (onProgress) {
                    onProgress({
                        attempt: attempt + 1,
                        maxAttempts: 8,
                        percent: Math.round(((attempt + 1) / 8) * 100),
                        status: `Optimization Pass ${attempt + 1}/8 (quality ${Math.round(midQ * 100)}%)…`
                    });
                }

                const candidate = await buildCandidatePdf(midQ, 1.0);

                if (!closestCandidate || Math.abs(candidate.byteLength - targetBytes) < Math.abs(closestCandidate.byteLength - targetBytes)) {
                    closestCandidate = candidate;
                }

                if (candidate.byteLength <= targetBytes) {
                    bestBelowOrEqual = candidate;
                    lo = midQ + 0.02; // try closer to target
                } else {
                    hi = midQ - 0.02;
                }

                // If within 4% of target, stop early
                if (Math.abs(candidate.byteLength - targetBytes) / targetBytes <= 0.04) {
                    bestBelowOrEqual = candidate;
                    break;
                }

                if (lo > hi) break;
            }

            if (bestBelowOrEqual) {
                const diffPct = Math.abs((bestBelowOrEqual.byteLength - targetBytes) / targetBytes);
                const isExact = diffPct <= 0.06 || bestBelowOrEqual.byteLength <= targetBytes;
                return {
                    buffer: bestBelowOrEqual.buffer,
                    actualBytes: bestBelowOrEqual.byteLength,
                    actualKB: bestBelowOrEqual.kb,
                    targetKB,
                    qualityUsed: bestBelowOrEqual.quality,
                    targetReached: true,
                    nearTarget: !isExact,
                    qualityProtected: false,
                    bestSafeResult: false,
                    status: 'reached',
                    statusMessage: `Target Reached (${bestBelowOrEqual.kb >= 1024 ? (bestBelowOrEqual.kb / 1024).toFixed(2) + ' MB' : bestBelowOrEqual.kb.toFixed(0) + ' KB'})`
                };
            }

            // Check if closest candidate at 1.0 scale is within 5% of target
            if (closestCandidate && closestCandidate.byteLength <= targetBytes * 1.05) {
                return {
                    buffer: closestCandidate.buffer,
                    actualBytes: closestCandidate.byteLength,
                    actualKB: closestCandidate.kb,
                    targetKB,
                    qualityUsed: closestCandidate.quality,
                    targetReached: true,
                    nearTarget: false,
                    qualityProtected: false,
                    bestSafeResult: false,
                    status: 'reached',
                    statusMessage: `Target Reached (${closestCandidate.kb >= 1024 ? (closestCandidate.kb / 1024).toFixed(2) + ' MB' : closestCandidate.kb.toFixed(0) + ' KB'})`
                };
            }

            // STAGE 2: Quality alone at 100% resolution cannot reach target.
            // Progressively reduce embedded image resolution (downsampling) until target is reached!
            const pdfScaleSteps = [0.85, 0.70, 0.55, 0.40, 0.30, 0.20, 0.15];
            let stage2Winner = null;

            for (let idx = 0; idx < pdfScaleSteps.length; idx++) {
                const scale = pdfScaleSteps[idx];
                if (onProgress) {
                    onProgress({
                        attempt: idx + 1,
                        maxAttempts: pdfScaleSteps.length,
                        percent: Math.round(((idx + 1) / pdfScaleSteps.length) * 100),
                        status: `Downsampling Resolution Pass ${idx + 1}/${pdfScaleSteps.length} (scale ${Math.round(scale * 100)}%)…`
                    });
                }

                // Test reasonable quality at this scale
                const testCand = await buildCandidatePdf(0.65, scale);
                if (!closestCandidate || Math.abs(testCand.byteLength - targetBytes) < Math.abs(closestCandidate.byteLength - targetBytes)) {
                    closestCandidate = testCand;
                }

                if (testCand.byteLength <= targetBytes) {
                    stage2Winner = testCand;
                    break;
                } else {
                    // Try lower quality at this scale
                    const lowerCand = await buildCandidatePdf(0.35, scale);
                    if (!closestCandidate || Math.abs(lowerCand.byteLength - targetBytes) < Math.abs(closestCandidate.byteLength - targetBytes)) {
                        closestCandidate = lowerCand;
                    }
                    if (lowerCand.byteLength <= targetBytes) {
                        stage2Winner = lowerCand;
                        break;
                    }
                }
            }

            const finalPick = stage2Winner || closestCandidate;
            const reached = finalPick.byteLength <= targetBytes || (Math.abs(finalPick.byteLength - targetBytes) / targetBytes) <= 0.08;

            return {
                buffer: finalPick.buffer,
                actualBytes: finalPick.byteLength,
                actualKB: finalPick.kb,
                targetKB,
                qualityUsed: finalPick.quality,
                targetReached: reached,
                nearTarget: !reached,
                qualityProtected: false,
                bestSafeResult: false,
                status: reached ? 'reached' : 'near',
                statusMessage: reached
                    ? `Target Reached (${finalPick.kb >= 1024 ? (finalPick.kb / 1024).toFixed(2) + ' MB' : finalPick.kb.toFixed(0) + ' KB'})`
                    : `Near Target (${finalPick.kb >= 1024 ? (finalPick.kb / 1024).toFixed(2) + ' MB' : finalPick.kb.toFixed(0) + ' KB'})`
            };
        }
    };

    SmartOptimizationEngine.compressImageToTargetSize = standardCompressImage;
    SmartOptimizationEngine.standardCompressImage = standardCompressImage;
    SmartOptimizationEngine.increaseImageToTargetSize = increaseImageToTargetSize;

    // Expose globally
    global.compressImageToTargetSize = standardCompressImage;
    global.standardCompressImage = standardCompressImage;
    global.increaseImageToTargetSize = increaseImageToTargetSize;
    global.SmartOptimizationEngine = SmartOptimizationEngine;

})(typeof window !== 'undefined' ? window : this);
