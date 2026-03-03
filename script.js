const uploadArea = document.getElementById('upload-area');
const imageInput = document.getElementById('image-input');
const workspace = document.getElementById('workspace');
const resultsGrid = document.getElementById('results-grid');
const statsDashboard = document.getElementById('stats-dashboard');
const totalSavedValue = document.getElementById('total-saved-value');
const qualitySlider = document.getElementById('quality-slider');
const qualityValue = document.getElementById('quality-value');
const formatSelect = document.getElementById('format-select');
const sizeSelect = document.getElementById('size-select');
const resetBtn = document.getElementById('reset-btn');
const downloadZipBtn = document.getElementById('download-zip-btn');
const downloadPdfBtn = document.getElementById('download-pdf-btn');
const themeToggle = document.getElementById('theme-toggle');

const FREE_LIMIT = 5; 

// ESTADO GLOBAL DA APLICAÇÃO (Necessário para controlo individual)
let filesState = []; 
let processTimer; 

// TEMA
if (localStorage.getItem('theme') === 'dark' || (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.body.classList.add('dark-theme'); themeToggle.innerText = '☀️';
}
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
    themeToggle.innerText = document.body.classList.contains('dark-theme') ? '☀️' : '🌙';
});

// UPLOADS
uploadArea.addEventListener('click', () => imageInput.click());
['dragover', 'dragleave', 'drop'].forEach(evt => uploadArea.addEventListener(evt, e => { e.preventDefault(); e.stopPropagation(); }));
uploadArea.addEventListener('dragover', () => uploadArea.classList.add('drag-active'));
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-active'));
uploadArea.addEventListener('drop', e => { uploadArea.classList.remove('drag-active'); handleFiles(e.dataTransfer.files); });
imageInput.addEventListener('change', e => { if(e.target.files) handleFiles(e.target.files); });
document.addEventListener('paste', e => {
    const items = e.clipboardData.items;
    let imagesColadas = [];
    for (let i = 0; i < items.length; i++) if (items[i].type.startsWith('image/')) imagesColadas.push(items[i].getAsFile());
    if (imagesColadas.length > 0) handleFiles(imagesColadas);
});

function handleFiles(files) {
    const validImages = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (validImages.length === 0) return;

    // Inicializa o estado para cada novo ficheiro
    validImages.forEach(file => {
        filesState.push({
            id: Date.now() + Math.random(),
            originalFile: file,
            originalSize: file.size,
            indivQuality: parseFloat(qualitySlider.value), // Herda a qualidade global atual
            rotation: 0,
            finalBlob: null,
            finalUrl: null,
            finalFormat: null,
            finalWidth: 0,
            finalHeight: 0
        });
    });

    uploadArea.classList.add('hidden');
    workspace.classList.remove('hidden');
    statsDashboard.classList.remove('hidden');
    
    renderGrid();
}

// CONTROLOS GLOBAIS
qualitySlider.addEventListener('input', function() {
    qualityValue.innerText = this.value + '%';
    // Atualiza o estado de todos e re-renderiza
    filesState.forEach(item => item.indivQuality = parseFloat(this.value));
    clearTimeout(processTimer);
    processTimer = setTimeout(renderGrid, 300);
});
formatSelect.addEventListener('change', () => {
    if (formatSelect.value === 'image/png') { qualitySlider.disabled = true; qualityValue.innerText = 'Máxima'; } 
    else { qualitySlider.disabled = false; qualityValue.innerText = qualitySlider.value + '%'; }
    renderGrid();
});
sizeSelect.addEventListener('change', renderGrid);

// === RENDERIZAÇÃO DA GRELHA BASEADA NO ESTADO ===
async function renderGrid() {
    // Revoga URLs antigos para poupar memória
    filesState.forEach(item => { if(item.finalUrl) URL.revokeObjectURL(item.finalUrl); });
    resultsGrid.innerHTML = '';
    let totalOriginal = 0; let totalCompressed = 0;

    const filesToProcess = filesState.slice(0, FREE_LIMIT);
    
    for (let i = 0; i < filesToProcess.length; i++) {
        await processSingleItem(filesToProcess[i]);
        createCardDOM(filesToProcess[i], i);
        totalOriginal += filesToProcess[i].originalSize;
        totalCompressed += filesToProcess[i].finalBlob ? filesToProcess[i].finalBlob.size : filesToProcess[i].originalSize;
    }

    if (filesState.length > FREE_LIMIT) {
        filesState.slice(FREE_LIMIT).forEach(item => createLockedCardDOM(item));
    }

    // Atualiza o Dashboard de Estatísticas
    const savedBytes = totalOriginal - totalCompressed;
    if(savedBytes > 0) {
        totalSavedValue.innerText = formatBytes(savedBytes);
        totalSavedValue.className = "stat-value text-success";
    } else {
        totalSavedValue.innerText = "0 MB";
        totalSavedValue.className = "stat-value";
    }
}

// === MOTOR DE COMPRESSÃO (Agora suporta Rotação) ===
function getCanvasBlob(canvas, format, quality) { return new Promise(resolve => canvas.toBlob(resolve, format, quality)); }

async function processSingleItem(item) {
    return new Promise((resolve) => {
        const globalFormat = formatSelect.value;
        const maxSize = sizeSelect.value === 'original' ? Infinity : parseInt(sizeSelect.value);

        const img = new Image();
        img.src = URL.createObjectURL(item.originalFile);

        img.onload = async () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Lógica de Rotação (Se girou 90 ou 270 graus, inverte largura e altura)
            let isRotated90 = (item.rotation / 90) % 2 !== 0;
            let rawWidth = isRotated90 ? img.height : img.width;
            let rawHeight = isRotated90 ? img.width : img.height;

            // Redimensionamento
            let width = rawWidth, height = rawHeight;
            if (width > maxSize || height > maxSize) {
                if (width > height) { height = Math.round((height * maxSize) / width); width = maxSize; }
                else { width = Math.round((width * maxSize) / height); height = maxSize; }
            }

            canvas.width = width; canvas.height = height;

            // Aplica a rotação no contexto do Canvas
            ctx.save();
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(item.rotation * Math.PI / 180);
            
            // Desenha a imagem compensando a translação e rotação
            if(isRotated90) { ctx.drawImage(img, -height/2, -width/2, height, width); } 
            else { ctx.drawImage(img, -width/2, -height/2, width, height); }
            ctx.restore();

            let finalBlob, finalFormat;
            const qualityDec = item.indivQuality / 100;

            if (globalFormat === 'auto') {
                const webpBlob = await getCanvasBlob(canvas, 'image/webp', qualityDec);
                const jpegBlob = await getCanvasBlob(canvas, 'image/jpeg', qualityDec);
                if (webpBlob && jpegBlob) {
                    if (webpBlob.size <= jpegBlob.size) { finalBlob = webpBlob; finalFormat = 'image/webp'; } 
                    else { finalBlob = jpegBlob; finalFormat = 'image/jpeg'; }
                } else {
                    finalBlob = webpBlob || jpegBlob; finalFormat = webpBlob ? 'image/webp' : 'image/jpeg';
                }
            } else {
                finalBlob = await getCanvasBlob(canvas, globalFormat, qualityDec);
                finalFormat = globalFormat;
            }

            item.finalBlob = finalBlob;
            item.finalUrl = URL.createObjectURL(finalBlob);
            item.finalFormat = finalFormat;
            item.finalWidth = width;
            item.finalHeight = height;

            URL.revokeObjectURL(img.src);
            resolve();
        };
        img.onerror = resolve; 
    });
}

// === CRIAÇÃO DO CARTÃO COM CONTROLOS INDIVIDUAIS ===
function createCardDOM(item, index) {
    if(!item.finalBlob) return;
    
    const savingsPct = Math.round(((item.originalSize - item.finalBlob.size) / item.originalSize) * 100);
    const hasError = savingsPct < 0; 
    const badgeText = hasError ? `+${Math.abs(savingsPct)}%` : `-${savingsPct}%`;
    const badgeClass = hasError ? 'danger' : 'success';
    const autoBadge = formatSelect.value === 'auto' ? `<div class="card-badge auto">${item.finalFormat.split('/')[1].toUpperCase()}</div>` : '';

    const card = document.createElement('div');
    card.className = 'result-card fade-in';
    card.innerHTML = `
        <div class="card-img">
            ${autoBadge}
            <div class="card-badge ${badgeClass}">${badgeText}</div>
            <div class="card-actions">
                <button class="btn-small-icon rotate-btn" title="Rodar 90º">↻</button>
            </div>
            <img src="${item.finalUrl}" alt="Preview" style="transform: scale(1);">
        </div>
        <div class="card-info">
            <h4>${item.originalFile.name.split('.')[0]}</h4>
            <p><span>De: ${formatBytes(item.originalSize)}</span> <span>Para: ${formatBytes(item.finalBlob.size)}</span></p>
            
            <div class="indiv-control">
                <label>Qualidade:</label>
                <input type="range" class="indiv-slider" min="10" max="100" value="${item.indivQuality}">
                <span>${item.indivQuality}%</span>
            </div>
        </div>
        <a href="${item.finalUrl}" download="${item.originalFile.name.split('.')[0]}-otimizado.${item.finalFormat.split('/')[1]}" class="btn-card-download">Baixar</a>
    `;

    // Evento do Slider Individual
    const slider = card.querySelector('.indiv-slider');
    const sliderText = card.querySelector('.indiv-control span');
    slider.addEventListener('input', (e) => {
        sliderText.innerText = `${e.target.value}%`;
        item.indivQuality = parseFloat(e.target.value);
        clearTimeout(processTimer);
        processTimer = setTimeout(renderGrid, 400); // Re-renderiza a grelha com a nova qualidade
    });

    // Evento de Rodar
    const rotateBtn = card.querySelector('.rotate-btn');
    rotateBtn.addEventListener('click', () => {
        item.rotation = (item.rotation + 90) % 360;
        renderGrid(); // Recalcula tudo instantaneamente
    });

    resultsGrid.appendChild(card);
}

function createLockedCardDOM(item) {
    const card = document.createElement('div');
    card.className = 'result-card fade-in locked-card';
    card.innerHTML = `
        <div class="paywall-overlay">
            <h3>🔒 Limite Atingido</h3>
            <p>Faça upgrade para Premium.</p>
            <button class="btn-premium">Desbloquear Premium</button>
        </div>
        <div class="card-img"><img src="" alt="Bloqueado" style="background:#ddd;"></div>
        <div class="card-info">
            <h4>${item.originalFile.name.split('.')[0]}</h4>
            <p><span>Tamanho:</span> <span>${formatBytes(item.originalSize)}</span></p>
        </div>
    `;
    resultsGrid.appendChild(card);
}

// === EXPORTAÇÕES ===
downloadZipBtn.addEventListener('click', () => {
    const validItems = filesState.filter(item => item.finalBlob).slice(0, FREE_LIMIT);
    if (validItems.length === 0) return;
    
    const zip = new JSZip();
    const folder = zip.folder("Imagens_Otimizadas");
    validItems.forEach(item => {
        const ext = item.finalFormat.split('/')[1];
        folder.file(`${item.originalFile.name.split('.')[0]}-otimizado.${ext}`, item.finalBlob);
    });
    
    const originalText = downloadZipBtn.innerText;
    downloadZipBtn.innerText = "⏳ A gerar..."; downloadZipBtn.disabled = true;
    zip.generateAsync({ type: "blob" }).then(content => {
        const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = `otimizadas-${Date.now()}.zip`; link.click();
        downloadZipBtn.innerText = originalText; downloadZipBtn.disabled = false;
    });
});

const blobToBase64 = blob => new Promise(resolve => {
    const reader = new FileReader(); reader.onloadend = () => resolve(reader.result); reader.readAsDataURL(blob);
});

downloadPdfBtn.addEventListener('click', async () => {
    const validItems = filesState.filter(item => item.finalBlob).slice(0, FREE_LIMIT);
    if (validItems.length === 0) return;
    
    const originalText = downloadPdfBtn.innerText;
    downloadPdfBtn.innerText = "⏳ A gerar..."; downloadPdfBtn.disabled = true;

    try {
        const { jsPDF } = window.jspdf; const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth(), pageHeight = pdf.internal.pageSize.getHeight();

        for (let i = 0; i < validItems.length; i++) {
            const item = validItems[i];
            const base64Img = await blobToBase64(item.finalBlob);
            const imgRatio = item.finalWidth / item.finalHeight;
            let finalWidth = pageWidth - 20, finalHeight = finalWidth / imgRatio;
            if (finalHeight > pageHeight - 20) { finalHeight = pageHeight - 20; finalWidth = finalHeight * imgRatio; }
            const x = (pageWidth - finalWidth) / 2, y = (pageHeight - finalHeight) / 2;
            if (i > 0) pdf.addPage();
            pdf.addImage(base64Img, item.finalFormat === 'image/jpeg' ? 'JPEG' : 'WEBP', x, y, finalWidth, finalHeight);
        }
        pdf.save(`imagens-otimizadas-${Date.now()}.pdf`);
    } catch (e) { alert("Erro ao gerar PDF."); } 
    finally { downloadPdfBtn.innerText = originalText; downloadPdfBtn.disabled = false; }
});

resetBtn.addEventListener('click', () => location.reload());

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(1)) + ' ' + ['B', 'KB', 'MB', 'GB'][i];
}
