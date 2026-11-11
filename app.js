const state = {
  people: [],
  items: [],
  nextPersonId: 1,
  nextItemId: 1,
  nextScannedItemId: 1,
  scannedItems: [],
  billPreviewUrl: '',
  isScanning: false,
  payerAmountTouched: false,
  latestBill: null
};

const elements = {
  eventName: document.querySelector('#eventName'),
  personForm: document.querySelector('#personForm'),
  personName: document.querySelector('#personName'),
  personFeedback: document.querySelector('#personFeedback'),
  peopleList: document.querySelector('#peopleList'),
  payerSelect: document.querySelector('#payerSelect'),
  amountPaid: document.querySelector('#amountPaid'),
  actualPaidHint: document.querySelector('#actualPaidHint'),
  itemForm: document.querySelector('#itemForm'),
  itemName: document.querySelector('#itemName'),
  itemPrice: document.querySelector('#itemPrice'),
  itemQuantity: document.querySelector('#itemQuantity'),
  itemFeedback: document.querySelector('#itemFeedback'),
  itemList: document.querySelector('#itemList'),
  billUpload: document.querySelector('#billUpload'),
  billCamera: document.querySelector('#billCamera'),
  scanPlaceholder: document.querySelector('#scanPlaceholder'),
  billPreviewImage: document.querySelector('#billPreviewImage'),
  scanOverlay: document.querySelector('#scanOverlay'),
  scanProgress: document.querySelector('#scanProgress'),
  scanStatusText: document.querySelector('#scanStatusText'),
  scanFeedback: document.querySelector('#scanFeedback'),
  scanResults: document.querySelector('#scanResults'),
  detectedItemCount: document.querySelector('#detectedItemCount'),
  scannedItemsList: document.querySelector('#scannedItemsList'),
  ocrRawText: document.querySelector('#ocrRawText'),
  clearScanButton: document.querySelector('#clearScanButton'),
  importScannedButton: document.querySelector('#importScannedButton'),
  gstEnabled: document.querySelector('#gstEnabled'),
  gstRate: document.querySelector('#gstRate'),
  gstRateField: document.querySelector('#gstRateField'),
  roundOffEnabled: document.querySelector('#roundOffEnabled'),
  billPreview: document.querySelector('#billPreview'),
  calculateButton: document.querySelector('#calculateButton'),
  calculationFeedback: document.querySelector('#calculationFeedback'),
  summaryContent: document.querySelector('#summaryContent')
};

const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function toPaise(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function formatMoney(paise) {
  return currencyFormatter.format(paise / 100);
}

function getInitial(name) {
  return name.trim().charAt(0) || '?';
}

function getPerson(personId) {
  return state.people.find((person) => person.id === personId);
}

function setFeedback(element, message = '', type = '') {
  element.textContent = message;
  element.className = `field-feedback${type ? ` ${type}` : ''}`;
}

function parseOcrAmount(value) {
  const amount = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(amount) ? amount : 0;
}

function cleanDetectedName(value) {
  let name = String(value)
    .replace(/\b(?:rs\.?|inr)\b/gi, ' ')
    .replace(/[₹|]/g, ' ')
    .replace(/^[\s.:;,_-]+|[\s.:;,_-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (name && name === name.toLocaleUpperCase('en-IN')) {
    name = name
      .toLocaleLowerCase('en-IN')
      .replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase('en-IN'));
  }
  return name;
}

function makeDetectedItem(name, quantity, unitPrice, sourceLine) {
  const cleanedName = cleanDetectedName(name);
  const safeQuantity = Number(quantity);
  const safeUnitPrice = Number(unitPrice);
  const excludedWords = /\b(?:sub\s*total|grand\s*total|total|gst|cgst|sgst|igst|tax|discount|round(?:ing)?|amount|cash|card|upi|change|invoice|bill\s*(?:no|number)?|date|time|table|server|phone|fssai|thank|balance|service\s*charge|net\s*payable)\b/i;

  if (
    !cleanedName
    || cleanedName.length < 2
    || cleanedName.length > 80
    || !/\p{L}/u.test(cleanedName)
    || excludedWords.test(cleanedName)
    || !Number.isInteger(safeQuantity)
    || safeQuantity < 1
    || safeQuantity > 999
    || !Number.isFinite(safeUnitPrice)
    || safeUnitPrice <= 0
  ) {
    return null;
  }

  return {
    name: cleanedName,
    quantity: safeQuantity,
    unitPrice: Math.round(safeUnitPrice * 100) / 100,
    sourceLine
  };
}

function parseBillLine(sourceLine) {
  const line = String(sourceLine)
    .replace(/[₹|]/g, ' ')
    .replace(/\b(?:rs\.?|inr)\b/gi, ' ')
    .replace(/[•·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line || line.length > 140) return null;

  const amount = String.raw`\d+(?:,\d{3})*(?:\.\d{1,2})?`;
  let match;

  match = new RegExp(`^(\\d{1,3})\\s*(?:[xX×]\\s*)?(.+?)\\s+(${amount})\\s+(${amount})$`).exec(line);
  if (match) {
    const quantity = Number(match[1]);
    return makeDetectedItem(match[2], quantity, parseOcrAmount(match[3]), sourceLine);
  }

  match = new RegExp(`^(.+?)\\s+(\\d{1,3})\\s+(${amount})\\s+(${amount})$`).exec(line);
  if (match) {
    const quantity = Number(match[2]);
    return makeDetectedItem(match[1], quantity, parseOcrAmount(match[3]), sourceLine);
  }

  match = new RegExp(`^(\\d{1,3})\\s*[xX×]\\s*(.+?)\\s+(${amount})$`).exec(line);
  if (match) {
    const quantity = Number(match[1]);
    const lineTotal = parseOcrAmount(match[3]);
    return makeDetectedItem(match[2], quantity, lineTotal / quantity, sourceLine);
  }

  match = new RegExp(`^(\\d{1,3})\\s+(.+?)\\s+(${amount})$`).exec(line);
  if (match && Number(match[1]) <= 100) {
    const quantity = Number(match[1]);
    const lineTotal = parseOcrAmount(match[3]);
    return makeDetectedItem(match[2], quantity, lineTotal / quantity, sourceLine);
  }

  match = new RegExp(`^(.+?)\\s+(\\d{1,3})\\s+(${amount})$`).exec(line);
  if (match && Number(match[2]) <= 100) {
    const quantity = Number(match[2]);
    const lineTotal = parseOcrAmount(match[3]);
    return makeDetectedItem(match[1], quantity, lineTotal / quantity, sourceLine);
  }

  match = new RegExp(`^(.+?)\\s+(${amount})$`).exec(line);
  if (match) {
    return makeDetectedItem(match[1], 1, parseOcrAmount(match[2]), sourceLine);
  }

  return null;
}

function parseBillItems(rawText) {
  const lines = String(rawText)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const detectedItems = [];

  for (let index = 0; index < lines.length; index += 1) {
    let item = parseBillLine(lines[index]);

    if (!item && index + 1 < lines.length && /\p{L}/u.test(lines[index])) {
      item = parseBillLine(`${lines[index]} ${lines[index + 1]}`);
      if (item) index += 1;
    }

    if (item) detectedItems.push(item);
  }

  return detectedItems;
}

function detectVenueName(rawText) {
  const genericLabels = /^(?:restaurant\s+bill|tax\s+invoice|invoice|receipt|bill|customer\s+copy|order\s+summary)$/i;
  const nonVenueDetails = /\b(?:gstin|fssai|phone|mobile|tel|date|time|table|cashier|server|address|road|street|avenue|pin\s*code)\b/i;
  const lines = String(rawText)
    .split(/\r?\n/)
    .slice(0, 10)
    .map((line) => line.replace(/^[#*+\-\s]+/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const line of lines) {
    if (
      line.length < 3
      || line.length > 80
      || genericLabels.test(line)
      || nonVenueDetails.test(line)
      || parseBillLine(line)
      || /\d+(?:\.\d{1,2})/.test(line)
    ) {
      continue;
    }

    const name = cleanDetectedName(line);
    const letterCount = (name.match(/\p{L}/gu) || []).length;
    if (letterCount >= 3 && name.split(/\s+/).length <= 8) return name;
  }

  return '';
}

function updateScanProgress(status, progress = 0) {
  const readableStatuses = {
    'loading tesseract core': 'Loading OCR engine…',
    'initializing tesseract': 'Initializing scanner…',
    'loading language traineddata': 'Loading language model…',
    'initializing api': 'Preparing recognition…',
    'recognizing text': 'Reading item rows…'
  };
  elements.scanStatusText.textContent = readableStatuses[status] || 'Reading bill…';
  const percentage = Number.isFinite(progress) ? Math.round(progress * 100) : 0;
  elements.scanProgress.style.width = `${Math.max(4, percentage)}%`;
}

function renderScannedItems() {
  elements.detectedItemCount.textContent = String(state.scannedItems.length);
  elements.scannedItemsList.innerHTML = state.scannedItems.map((item) => {
    const pricePaise = toPaise(item.unitPrice);
    const quantity = Number(item.quantity) || 0;
    return `
      <div class="scan-item-row${item.selected ? '' : ' is-excluded'}" data-scan-item-id="${item.id}">
        <label class="scan-item-check" aria-label="Use ${escapeHtml(item.name)}">
          <input type="checkbox" data-scan-field="selected" ${item.selected ? 'checked' : ''}>
        </label>
        <label class="scan-field scan-name-field">
          <span>Item name</span>
          <input type="text" maxlength="80" value="${escapeHtml(item.name)}" data-scan-field="name">
        </label>
        <label class="scan-field scan-price-field">
          <span>Price each</span>
          <input type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(item.unitPrice)}" data-scan-field="unitPrice">
        </label>
        <label class="scan-field scan-quantity-field">
          <span>Quantity</span>
          <input type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(item.quantity)}" data-scan-field="quantity">
        </label>
        <strong class="scan-line-total">${formatMoney(pricePaise * quantity)}</strong>
      </div>
    `;
  }).join('');
  elements.scanResults.hidden = state.scannedItems.length === 0;
}

function clearBillScan() {
  if (state.billPreviewUrl) URL.revokeObjectURL(state.billPreviewUrl);
  state.billPreviewUrl = '';
  state.scannedItems = [];
  elements.billUpload.value = '';
  elements.billCamera.value = '';
  elements.billPreviewImage.removeAttribute('src');
  elements.billPreviewImage.hidden = true;
  elements.scanPlaceholder.hidden = false;
  elements.scanOverlay.hidden = true;
  elements.scanResults.hidden = true;
  elements.ocrRawText.textContent = '';
  elements.scanProgress.style.width = '0%';
  setFeedback(elements.scanFeedback);
}

function setScanStage(message, percentage) {
  elements.scanStatusText.textContent = message;
  elements.scanProgress.style.width = `${Math.max(4, Math.min(100, percentage))}%`;
}

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  });
}

async function prepareBillImage(file) {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1800;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const compressed = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
  if (!compressed) throw new Error('The image could not be prepared.');
  return {
    imageBase64: await blobToBase64(compressed),
    mimeType: 'image/jpeg'
  };
}

async function readApiResponse(response) {
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const error = new Error(payload.error || 'Cloud OCR is unavailable.');
    error.code = payload.code || 'OCR_API_ERROR';
    throw error;
  }
  return payload;
}

async function scanBillWithCloud(file) {
  if (window.location.protocol === 'file:') {
    const error = new Error('The cloud endpoint requires a deployed or local server.');
    error.code = 'OCR_NOT_CONFIGURED';
    throw error;
  }

  setScanStage('Preparing secure upload…', 8);
  const preparedImage = await prepareBillImage(file);
  setScanStage('Starting cost-effective receipt scan…', 16);
  const created = await fetch('/api/scan-bill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preparedImage)
  }).then(readApiResponse);
  if (!created.jobId) throw new Error('Cloud OCR did not return a job ID.');
  let currentJobId = created.jobId;

  for (let attempt = 0; attempt < 80; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
    const progress = 20 + Math.min(74, Math.round((attempt / 79) * 74));
    const response = await fetch(`/api/scan-bill?jobId=${encodeURIComponent(currentJobId)}`);
    const completed = await readApiResponse(response);
    if (response.status === 202) {
      currentJobId = completed.jobId || currentJobId;
      const stageMessage = completed.stage === 'PARSING'
        ? 'Correcting and reading receipt photo…'
        : 'Structuring menu items…';
      setScanStage(stageMessage, progress);
      continue;
    }
    const items = (completed.items || []).map((item) => makeDetectedItem(
      item.name,
      Number(item.quantity) || 1,
      Number(item.unitPrice),
      `${item.quantity || 1} ${item.name} ${item.unitPrice}`
    )).filter(Boolean);
    if (!items.length) throw new Error('LlamaExtract did not find any menu items.');
    setScanStage('Items detected', 100);
    return {
      items,
      rawText: completed.rawText || '',
      venueName: String(completed.venueName || '').trim(),
      provider: completed.provider || 'LlamaExtract'
    };
  }

  throw new Error('Cloud OCR took too long to finish.');
}

async function scanBillInBrowser(file) {
  if (!window.Tesseract) throw new Error('The fallback OCR library is unavailable.');
  setFeedback(elements.scanFeedback, 'Cloud OCR is unavailable; using private in-browser OCR.');
  const result = await window.Tesseract.recognize(file, 'eng', {
    logger: ({ status, progress }) => updateScanProgress(status, progress)
  });
  const rawText = result?.data?.text || '';
  return {
    items: parseBillItems(rawText),
    rawText,
    venueName: detectVenueName(rawText),
    provider: 'On-device OCR'
  };
}

function fillRendezvousFromScan(venueName) {
  if (elements.eventName.value.trim() || !venueName) return false;
  const cleanedVenueName = cleanDetectedName(venueName).slice(0, 100);
  if (!cleanedVenueName) return false;

  elements.eventName.value = cleanedVenueName;
  elements.eventName.classList.add('scan-filled');
  window.setTimeout(() => elements.eventName.classList.remove('scan-filled'), 1600);
  return true;
}

async function scanBillImage(file) {
  if (state.isScanning) return;
  if (!file || !/^image\/(?:png|jpeg|webp)$/.test(file.type)) {
    setFeedback(elements.scanFeedback, 'Choose a PNG, JPG, or WebP bill image.');
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    setFeedback(elements.scanFeedback, 'The image must be smaller than 12 MB.');
    return;
  }

  if (state.billPreviewUrl) URL.revokeObjectURL(state.billPreviewUrl);
  state.billPreviewUrl = URL.createObjectURL(file);
  elements.billPreviewImage.src = state.billPreviewUrl;
  elements.billPreviewImage.hidden = false;
  elements.scanPlaceholder.hidden = true;
  elements.scanResults.hidden = true;
  elements.scanOverlay.hidden = false;
  state.isScanning = true;
  setScanStage('Preparing bill scan…', 4);
  setFeedback(elements.scanFeedback, 'Scanning securely with LlamaExtract.');

  try {
    let scanResult;
    try {
      scanResult = await scanBillWithCloud(file);
    } catch (cloudError) {
      console.warn('Cloud OCR fallback:', cloudError.message);
      scanResult = await scanBillInBrowser(file);
    }
    const rendezvousFilled = fillRendezvousFromScan(scanResult.venueName);

    state.scannedItems = scanResult.items.map((item) => ({
      id: state.nextScannedItemId++,
      name: item.name,
      unitPrice: item.unitPrice.toFixed(2),
      quantity: String(item.quantity),
      selected: true,
      sourceLine: item.sourceLine
    }));
    elements.ocrRawText.textContent = scanResult.rawText.trim() || 'No readable text was found.';
    renderScannedItems();

    if (state.scannedItems.length) {
      setFeedback(
        elements.scanFeedback,
        `${state.scannedItems.length} item${state.scannedItems.length === 1 ? '' : 's'} detected with ${scanResult.provider}.${rendezvousFilled ? ' Rendezvous was filled from the bill.' : ''} Review before importing.`,
        'success'
      );
    } else {
      setFeedback(elements.scanFeedback, 'No menu items were detected. Try a clearer, straighter image.');
    }
  } catch (error) {
    console.error(error);
    state.scannedItems = [];
    elements.scanResults.hidden = true;
    setFeedback(elements.scanFeedback, 'The bill could not be read. Check your connection and try a clearer image.');
  } finally {
    state.isScanning = false;
    elements.scanOverlay.hidden = true;
    elements.billUpload.value = '';
    elements.billCamera.value = '';
  }
}

function updateScannedItem(event) {
  const input = event.target.closest('[data-scan-field]');
  const row = event.target.closest('[data-scan-item-id]');
  if (!input || !row) return;

  const itemId = Number(row.dataset.scanItemId);
  const item = state.scannedItems.find((candidate) => candidate.id === itemId);
  if (!item) return;

  const field = input.dataset.scanField;
  if (field === 'selected') {
    item.selected = input.checked;
    row.classList.toggle('is-excluded', !item.selected);
    return;
  }

  item[field] = input.value;
  row.classList.remove('is-invalid');
  const lineTotal = row.querySelector('.scan-line-total');
  const quantity = Number(item.quantity);
  const unitPricePaise = toPaise(item.unitPrice);
  lineTotal.textContent = formatMoney(
    Number.isInteger(quantity) && quantity > 0 ? unitPricePaise * quantity : 0
  );
}

function importScannedItems() {
  if (!state.people.length) {
    setFeedback(elements.scanFeedback, 'Add at least one person before importing detected items.');
    elements.personName.focus();
    return;
  }

  const selectedItems = state.scannedItems.filter((item) => item.selected);
  if (!selectedItems.length) {
    setFeedback(elements.scanFeedback, 'Select at least one detected item to import.');
    return;
  }

  const invalidItem = selectedItems.find((item) => {
    const quantity = Number(item.quantity);
    return !item.name.trim()
      || toPaise(item.unitPrice) <= 0
      || !Number.isInteger(quantity)
      || quantity < 1;
  });

  if (invalidItem) {
    elements.scannedItemsList
      .querySelector(`[data-scan-item-id="${invalidItem.id}"]`)
      ?.classList.add('is-invalid');
    setFeedback(elements.scanFeedback, 'Correct the highlighted item before importing.');
    return;
  }

  selectedItems.forEach((item) => {
    const unitPricePaise = toPaise(item.unitPrice);
    const quantity = Number(item.quantity);
    state.items.push({
      id: state.nextItemId,
      name: item.name.trim(),
      unitPricePaise,
      quantity,
      pricePaise: unitPricePaise * quantity,
      mode: 'equal',
      participantIds: state.people.map((person) => person.id),
      customShares: {}
    });
    state.nextItemId += 1;
  });

  const importedCount = selectedItems.length;
  clearBillScan();
  renderItems();
  updateBillPreview();
  setFeedback(
    elements.itemFeedback,
    `${importedCount} scanned item${importedCount === 1 ? '' : 's'} imported. Choose who shared each item below.`,
    'success'
  );
}

function getBillMeta() {
  const subtotalPaise = state.items.reduce((sum, item) => sum + item.pricePaise, 0);
  const gstRate = elements.gstEnabled.checked ? Number(elements.gstRate.value) || 0 : 0;
  const gstPaise = elements.gstEnabled.checked
    ? Math.round(subtotalPaise * (gstRate / 100))
    : 0;

  return {
    subtotalPaise,
    gstRate,
    gstPaise,
    totalPaise: subtotalPaise + gstPaise
  };
}

function updateBillPreview() {
  const { totalPaise } = getBillMeta();
  elements.billPreview.textContent = formatMoney(totalPaise);
  elements.actualPaidHint.textContent = totalPaise
    ? `Calculated bill: ${formatMoney(totalPaise)}. Change the amount only if the actual payment differed.`
    : 'The final bill amount will be filled automatically.';

  if (!state.payerAmountTouched) {
    elements.amountPaid.value = totalPaise ? (totalPaise / 100).toFixed(2) : '';
  }
}

function renderPeople() {
  if (!state.people.length) {
    elements.peopleList.innerHTML = '<span class="empty-inline">No people added yet.</span>';
    return;
  }

  elements.peopleList.innerHTML = state.people.map((person) => `
    <span class="person-chip">
      <span class="person-avatar">${escapeHtml(getInitial(person.name))}</span>
      ${escapeHtml(person.name)}
      <button class="chip-remove" type="button" data-action="remove-person" data-person-id="${person.id}" aria-label="Remove ${escapeHtml(person.name)}">&times;</button>
    </span>
  `).join('');
}

function renderPayerOptions() {
  const currentPayerId = Number(elements.payerSelect.value);

  if (!state.people.length) {
    elements.payerSelect.innerHTML = '<option value="">Add people first</option>';
    elements.payerSelect.disabled = true;
    return;
  }

  elements.payerSelect.disabled = false;
  elements.payerSelect.innerHTML = state.people.map((person) => `
    <option value="${person.id}">${escapeHtml(person.name)}</option>
  `).join('');

  const payerStillExists = state.people.some((person) => person.id === currentPayerId);
  elements.payerSelect.value = String(payerStillExists ? currentPayerId : state.people[0].id);
}

function splitEqually(totalPaise, participantIds) {
  const shares = new Map();
  if (!participantIds.length) return shares;

  const baseShare = Math.floor(totalPaise / participantIds.length);
  let remainder = totalPaise % participantIds.length;

  participantIds.forEach((personId) => {
    shares.set(personId, baseShare + (remainder > 0 ? 1 : 0));
    remainder -= remainder > 0 ? 1 : 0;
  });

  return shares;
}

function getCustomShareTotal(item) {
  return item.participantIds.reduce(
    (sum, personId) => sum + toPaise(item.customShares[personId] || 0),
    0
  );
}

function getDistributionMessage(item) {
  if (!item.participantIds.length) {
    return { className: 'warning', text: 'Select at least one person for this item.' };
  }

  if (item.mode === 'equal') {
    const shares = splitEqually(item.pricePaise, item.participantIds);
    const firstShare = shares.get(item.participantIds[0]);
    return {
      className: '',
      text: `${formatMoney(item.pricePaise)} split between ${item.participantIds.length} ${item.participantIds.length === 1 ? 'person' : 'people'} (about ${formatMoney(firstShare)} each).`
    };
  }

  const assignedPaise = getCustomShareTotal(item);
  const differencePaise = item.pricePaise - assignedPaise;

  if (differencePaise === 0) {
    return { className: 'valid', text: `Fully assigned: ${formatMoney(assignedPaise)}.` };
  }

  if (differencePaise > 0) {
    return { className: 'warning', text: `${formatMoney(differencePaise)} still needs to be assigned.` };
  }

  return { className: 'warning', text: `Assigned amount is ${formatMoney(Math.abs(differencePaise))} over the item price.` };
}

function renderItems() {
  if (!state.items.length) {
    elements.itemList.innerHTML = `
      <div class="empty-state">
        <p>Your menu is empty. Add the first item above.</p>
      </div>
    `;
    return;
  }

  elements.itemList.innerHTML = state.items.map((item, index) => {
    const selectedPeople = item.participantIds
      .map((personId) => getPerson(personId))
      .filter(Boolean);
    const pickerLabel = selectedPeople.length
      ? `${selectedPeople.length} selected`
      : 'Choose people';
    const distribution = getDistributionMessage(item);
    const customInputs = item.mode === 'custom'
      ? selectedPeople.map((person) => `
          <label class="field" for="share-${item.id}-${person.id}">
            <span>${escapeHtml(person.name)}'s share</span>
            <span class="money-input">
              <span aria-hidden="true">₹</span>
              <input
                id="share-${item.id}-${person.id}"
                type="number"
                min="0"
                step="0.01"
                inputmode="decimal"
                placeholder="0.00"
                value="${escapeHtml(item.customShares[person.id] || '')}"
                data-action="custom-share"
                data-item-id="${item.id}"
                data-person-id="${person.id}"
              >
            </span>
          </label>
        `).join('')
      : '';

    return `
      <article class="menu-card" data-item-card="${item.id}">
        <div class="menu-card-top">
          <div>
            <span class="item-kicker">Item ${String(index + 1).padStart(2, '0')}</span>
            <h3>${escapeHtml(item.name)}</h3>
            <span class="item-unit-price">${item.quantity} × ${formatMoney(item.unitPricePaise)} each</span>
          </div>
          <div class="menu-price-actions">
            <span class="menu-price">${formatMoney(item.pricePaise)}</span>
            <button class="icon-button" type="button" data-action="remove-item" data-item-id="${item.id}" aria-label="Remove ${escapeHtml(item.name)}">&times;</button>
          </div>
        </div>

        <div class="menu-card-controls">
          <div class="segmented-control" role="radiogroup" aria-label="Split method for ${escapeHtml(item.name)}">
            <label class="segment">
              <input type="radio" name="mode-${item.id}" value="equal" data-action="change-mode" data-item-id="${item.id}" ${item.mode === 'equal' ? 'checked' : ''}>
              <span>Equal share</span>
            </label>
            <label class="segment">
              <input type="radio" name="mode-${item.id}" value="custom" data-action="change-mode" data-item-id="${item.id}" ${item.mode === 'custom' ? 'checked' : ''}>
              <span>Custom price</span>
            </label>
          </div>

          <details class="people-picker">
            <summary>
              <span>Shared by</span>
              <span class="picker-value">${pickerLabel}</span>
            </summary>
            <div class="picker-menu">
              ${state.people.map((person) => `
                <label class="picker-person">
                  <input
                    type="checkbox"
                    data-action="toggle-participant"
                    data-item-id="${item.id}"
                    data-person-id="${person.id}"
                    ${item.participantIds.includes(person.id) ? 'checked' : ''}
                  >
                  <span>${escapeHtml(person.name)}</span>
                </label>
              `).join('')}
            </div>
          </details>
        </div>

        ${customInputs ? `<div class="custom-share-grid">${customInputs}</div>` : ''}
        <p class="distribution-note ${distribution.className}" data-custom-status="${item.id}">${distribution.text}</p>
      </article>
    `;
  }).join('');
}

function updateCustomStatus(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  const status = elements.itemList.querySelector(`[data-custom-status="${itemId}"]`);
  if (!item || !status) return;

  const distribution = getDistributionMessage(item);
  status.className = `distribution-note ${distribution.className}`;
  status.textContent = distribution.text;
}

function syncGstControls() {
  const enabled = elements.gstEnabled.checked;
  elements.gstRate.disabled = !enabled;
  elements.gstRateField.classList.toggle('is-disabled', !enabled);
  updateBillPreview();
}

function addPerson(event) {
  event.preventDefault();
  const name = elements.personName.value.trim();

  if (!name) {
    setFeedback(elements.personFeedback, 'Enter a person name.');
    elements.personName.focus();
    return;
  }

  const duplicate = state.people.some(
    (person) => person.name.toLocaleLowerCase('en-IN') === name.toLocaleLowerCase('en-IN')
  );
  if (duplicate) {
    setFeedback(elements.personFeedback, `${name} is already on this bill.`);
    elements.personName.select();
    return;
  }

  state.people.push({ id: state.nextPersonId, name });
  state.nextPersonId += 1;
  elements.personName.value = '';
  setFeedback(elements.personFeedback, `${name} added.`, 'success');
  renderPeople();
  renderPayerOptions();
  renderItems();
  elements.personName.focus();
}

function removePerson(personId) {
  const person = getPerson(personId);
  if (!person) return;

  state.people = state.people.filter((candidate) => candidate.id !== personId);
  state.items.forEach((item) => {
    item.participantIds = item.participantIds.filter((id) => id !== personId);
    delete item.customShares[personId];
  });

  setFeedback(elements.personFeedback, `${person.name} removed.`);
  renderPeople();
  renderPayerOptions();
  renderItems();
}

function addItem(event) {
  event.preventDefault();
  const name = elements.itemName.value.trim();
  const unitPricePaise = toPaise(elements.itemPrice.value);
  const quantity = Number(elements.itemQuantity.value);

  if (!state.people.length) {
    setFeedback(elements.itemFeedback, 'Add at least one person before adding menu items.');
    elements.personName.focus();
    return;
  }

  if (!name) {
    setFeedback(elements.itemFeedback, 'Enter a menu item name.');
    elements.itemName.focus();
    return;
  }

  if (unitPricePaise <= 0) {
    setFeedback(elements.itemFeedback, 'Enter a price greater than ₹0.');
    elements.itemPrice.focus();
    return;
  }

  if (!Number.isInteger(quantity) || quantity < 1) {
    setFeedback(elements.itemFeedback, 'Quantity must be a whole number of 1 or more.');
    elements.itemQuantity.focus();
    return;
  }

  state.items.push({
    id: state.nextItemId,
    name,
    unitPricePaise,
    quantity,
    pricePaise: unitPricePaise * quantity,
    mode: 'equal',
    participantIds: state.people.map((person) => person.id),
    customShares: {}
  });
  state.nextItemId += 1;

  elements.itemName.value = '';
  elements.itemPrice.value = '';
  elements.itemQuantity.value = '1';
  setFeedback(elements.itemFeedback, `${quantity} × ${name} added. Choose who shared it below.`, 'success');
  renderItems();
  updateBillPreview();
  elements.itemName.focus();
}

function removeItem(itemId) {
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return;

  state.items = state.items.filter((candidate) => candidate.id !== itemId);
  setFeedback(elements.itemFeedback, `${item.name} removed.`);
  renderItems();
  updateBillPreview();
}

function allocateProportionally(totalPaise, weights) {
  const allocations = new Map([...weights.keys()].map((key) => [key, 0]));
  const weightTotal = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
  if (totalPaise === 0 || weightTotal <= 0) return allocations;

  const direction = totalPaise < 0 ? -1 : 1;
  const absoluteTotalPaise = Math.abs(totalPaise);

  const ranked = [...weights.entries()].map(([key, weight], index) => {
    const exactShare = absoluteTotalPaise * (weight / weightTotal);
    const baseShare = Math.floor(exactShare);
    allocations.set(key, baseShare * direction);
    return { key, index, remainder: exactShare - baseShare };
  });

  const allocatedAbsolutePaise = [...allocations.values()].reduce(
    (sum, share) => sum + Math.abs(share),
    0
  );
  const undistributed = absoluteTotalPaise - allocatedAbsolutePaise;
  ranked.sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (let index = 0; index < undistributed; index += 1) {
    const key = ranked[index % ranked.length].key;
    allocations.set(key, allocations.get(key) + direction);
  }

  return allocations;
}

function validateBill() {
  const errors = [];

  if (!state.people.length) errors.push('Add at least one person.');
  if (!state.items.length) errors.push('Add at least one menu item.');

  state.items.forEach((item) => {
    if (!item.participantIds.length) {
      errors.push(`Select who shared ${item.name}.`);
    }
    const hasNegativeCustomShare = item.mode === 'custom' && item.participantIds.some(
      (personId) => Number(item.customShares[personId] || 0) < 0
    );
    if (hasNegativeCustomShare) {
      errors.push(`Custom shares for ${item.name} cannot be negative.`);
    }
    if (item.mode === 'custom' && getCustomShareTotal(item) !== item.pricePaise) {
      errors.push(`Custom shares for ${item.name} must total ${formatMoney(item.pricePaise)}.`);
    }
  });

  const gstRate = Number(elements.gstRate.value);
  if (elements.gstEnabled.checked && (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100)) {
    errors.push('GST must be between 0% and 100%.');
  }

  const payerId = Number(elements.payerSelect.value);
  if (!getPerson(payerId)) errors.push('Choose the person who paid the bill.');

  return errors;
}

function calculatePersonTotals() {
  const consumption = new Map(state.people.map((person) => [person.id, 0]));

  state.items.forEach((item) => {
    const itemShares = item.mode === 'equal'
      ? splitEqually(item.pricePaise, item.participantIds)
      : new Map(item.participantIds.map((personId) => [personId, toPaise(item.customShares[personId] || 0)]));

    itemShares.forEach((share, personId) => {
      consumption.set(personId, (consumption.get(personId) || 0) + share);
    });
  });

  const { gstPaise } = getBillMeta();
  const gstShares = allocateProportionally(gstPaise, consumption);
  const finalShares = new Map(state.people.map((person) => [
    person.id,
    (consumption.get(person.id) || 0) + (gstShares.get(person.id) || 0)
  ]));

  return { consumption, gstShares, finalShares };
}

function calculateSettlement(amountPaidPaise, finalShares, payerId) {
  const rawShares = allocateProportionally(amountPaidPaise, finalShares);
  const settlementShares = new Map(rawShares);
  const nonPayerIds = state.people
    .map((person) => person.id)
    .filter((personId) => personId !== payerId);
  const rawReimbursement = nonPayerIds.reduce(
    (sum, personId) => sum + (rawShares.get(personId) || 0),
    0
  );

  if (elements.roundOffEnabled.checked) {
    nonPayerIds.forEach((personId) => {
      const rawShare = rawShares.get(personId) || 0;
      settlementShares.set(personId, Math.round(rawShare / 100) * 100);
    });

    let overflow = nonPayerIds.reduce(
      (sum, personId) => sum + (settlementShares.get(personId) || 0),
      0
    ) - amountPaidPaise;

    if (overflow > 0) {
      [...nonPayerIds]
        .sort((a, b) => settlementShares.get(b) - settlementShares.get(a))
        .forEach((personId) => {
          if (overflow <= 0) return;
          const currentShare = settlementShares.get(personId) || 0;
          const reduction = Math.min(currentShare, overflow);
          settlementShares.set(personId, currentShare - reduction);
          overflow -= reduction;
        });
    }
  }

  const reimbursement = nonPayerIds.reduce(
    (sum, personId) => sum + (settlementShares.get(personId) || 0),
    0
  );
  const payerOwnShare = amountPaidPaise - reimbursement;
  settlementShares.set(payerId, payerOwnShare);

  return {
    settlementShares,
    reimbursement,
    payerOwnShare,
    settlementAdjustmentPaise: reimbursement - rawReimbursement
  };
}

function renderSummary({ payerId, amountPaidPaise, consumption, gstShares, finalShares }) {
  const eventName = elements.eventName.value.trim() || 'Shared meal';
  const payer = getPerson(payerId);
  const { subtotalPaise, gstRate, gstPaise, totalPaise } = getBillMeta();
  const {
    settlementShares,
    reimbursement,
    payerOwnShare,
    settlementAdjustmentPaise
  } = calculateSettlement(amountPaidPaise, finalShares, payerId);
  const paymentDifference = amountPaidPaise - totalPaise;

  state.latestBill = {
    eventName,
    payerName: payer.name,
    subtotalPaise,
    gstRate,
    gstEnabled: elements.gstEnabled.checked,
    gstPaise,
    settlementRoundingEnabled: elements.roundOffEnabled.checked,
    settlementAdjustmentPaise,
    totalPaise,
    amountPaidPaise,
    payerOwnShare,
    reimbursement,
    paymentDifference,
    people: state.people.map((person) => ({
      id: person.id,
      name: person.name,
      isPayer: person.id === payerId,
      consumptionPaise: consumption.get(person.id) || 0,
      gstPaise: gstShares.get(person.id) || 0,
      finalSharePaise: finalShares.get(person.id) || 0,
      transferPaise: settlementShares.get(person.id) || 0
    }))
  };

  const personRows = state.people.map((person) => `
    <tr>
      <td>
        <span class="table-person">
          <span class="person-avatar">${escapeHtml(getInitial(person.name))}</span>
          <span>${escapeHtml(person.name)}${person.id === payerId ? '<span class="payer-badge">Payer</span>' : ''}</span>
        </span>
      </td>
      <td>${formatMoney(consumption.get(person.id) || 0)}</td>
      <td>${formatMoney(gstShares.get(person.id) || 0)}</td>
      <td><strong>${formatMoney(finalShares.get(person.id) || 0)}</strong></td>
    </tr>
  `).join('');

  const transferRows = state.people
    .filter((person) => person.id !== payerId)
    .map((person) => {
      const transferPaise = settlementShares.get(person.id) || 0;
      return `
        <div class="transfer-row">
          <div class="transfer-person">
            <span class="person-avatar">${escapeHtml(getInitial(person.name))}</span>
            <span>
              <strong>${escapeHtml(person.name)}</strong>
              <small>pays ${escapeHtml(payer.name)}</small>
            </span>
          </div>
          <strong>${formatMoney(transferPaise)}</strong>
        </div>
      `;
    }).join('') || '<div class="transfer-row"><span>No transfers needed.</span><strong>Settled</strong></div>';

  const adjustmentNotes = [];
  if (paymentDifference !== 0) {
    const differenceLabel = paymentDifference < 0 ? 'less than' : 'more than';
    adjustmentNotes.push(`The recorded payment is ${formatMoney(Math.abs(paymentDifference))} ${differenceLabel} the calculated total. Transfers were adjusted proportionally to ${formatMoney(amountPaidPaise)}.`);
  }
  if (elements.roundOffEnabled.checked) {
    const roundingEffect = settlementAdjustmentPaise === 0
      ? 'There was no rounding difference.'
      : `${escapeHtml(payer.name)} absorbs a ${formatMoney(Math.abs(settlementAdjustmentPaise))} rounding difference.`;
    adjustmentNotes.push(`Only repayment amounts are rounded to the nearest ₹1. ${roundingEffect}`);
  }
  const adjustmentNote = adjustmentNotes.length
    ? `<p class="adjustment-note">${adjustmentNotes.join(' ')}</p>`
    : '';

  elements.summaryContent.className = '';
  elements.summaryContent.innerHTML = `
    <div class="summary-header">
      <div>
        <p class="eyebrow">Settlement for</p>
        <h2 id="summaryHeading">${escapeHtml(eventName)}</h2>
      </div>
      <div class="summary-header-actions">
        <div class="summary-total">
          <span>Calculated total</span>
          <strong>${formatMoney(totalPaise)}</strong>
        </div>
        <button class="export-button" type="button" data-action="export-image">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 14v5h14v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Export PNG
        </button>
      </div>
    </div>

    <div class="summary-body">
      <div class="summary-metrics">
        <div class="metric-card">
          <span>Subtotal</span>
          <strong>${formatMoney(subtotalPaise)}</strong>
        </div>
        <div class="metric-card">
          <span>GST${elements.gstEnabled.checked ? ` · ${gstRate}%` : ' · Off'}</span>
          <strong>${formatMoney(gstPaise)}</strong>
        </div>
        <div class="metric-card">
          <span>Paid by ${escapeHtml(payer.name)}</span>
          <strong>${formatMoney(amountPaidPaise)}</strong>
        </div>
      </div>

      <h3 class="summary-section-title">Share by consumption</h3>
      <div class="breakdown-scroll">
        <table class="breakdown-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Food</th>
              <th>GST</th>
              <th>Total share</th>
            </tr>
          </thead>
          <tbody>${personRows}</tbody>
        </table>
      </div>

      <h3 class="summary-section-title">Who pays whom</h3>
      <div class="settlement-card">
        <div class="payer-card">
          <span>${escapeHtml(payer.name)} receives</span>
          <strong class="receive-amount">${formatMoney(reimbursement)}</strong>
          <small>Their own adjusted share is ${formatMoney(payerOwnShare)}.</small>
        </div>
        <div class="transfer-list">${transferRows}</div>
      </div>
      ${adjustmentNote}
    </div>
  `;

  document.querySelector('#summarySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function calculateBill() {
  const errors = validateBill();
  if (errors.length) {
    elements.calculationFeedback.textContent = errors[0];
    return;
  }

  const { totalPaise } = getBillMeta();
  let amountPaidPaise = toPaise(elements.amountPaid.value);
  if (!elements.amountPaid.value.trim()) {
    amountPaidPaise = totalPaise;
    elements.amountPaid.value = (totalPaise / 100).toFixed(2);
  }

  if (amountPaidPaise <= 0) {
    elements.calculationFeedback.textContent = 'Enter the amount paid by the payer.';
    elements.amountPaid.focus();
    return;
  }

  elements.calculationFeedback.textContent = '';
  const totals = calculatePersonTotals();
  renderSummary({
    payerId: Number(elements.payerSelect.value),
    amountPaidPaise,
    ...totals
  });
}

function roundedRectangle(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function drawCanvasCard(context, x, y, width, height, options = {}) {
  const {
    radius = 22,
    fill = '#0d2034',
    stroke = 'rgba(180, 208, 238, 0.15)',
    shadow = false
  } = options;

  context.save();
  if (shadow) {
    context.shadowColor = 'rgba(0, 0, 0, 0.28)';
    context.shadowBlur = 28;
    context.shadowOffsetY = 14;
  }
  roundedRectangle(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  context.shadowColor = 'transparent';
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1.5;
    context.stroke();
  }
  context.restore();
}

function fitCanvasText(context, value, maxWidth) {
  const text = String(value);
  if (context.measureText(text).width <= maxWidth) return text;

  let shortened = text;
  while (shortened.length > 1 && context.measureText(`${shortened}…`).width > maxWidth) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function createBillCanvas(bill) {
  const width = 1400;
  const padding = 72;
  const tableHeaderHeight = 54;
  const personRowHeight = 72;
  const tableTop = 500;
  const tableHeight = tableHeaderHeight + bill.people.length * personRowHeight;
  const settlementTop = tableTop + tableHeight + 92;
  const transfers = bill.people.filter((person) => !person.isPayer);
  const transferListHeight = transfers.length ? transfers.length * 74 - 10 : 70;
  const settlementHeight = Math.max(170, transferListHeight);
  const hasAdjustmentNote = bill.paymentDifference !== 0 || bill.settlementRoundingEnabled;
  const adjustmentHeight = hasAdjustmentNote ? 74 : 0;
  const footerTop = settlementTop + settlementHeight + adjustmentHeight + 94;
  const height = footerTop + 92;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = width;
  canvas.height = height;

  const background = context.createLinearGradient(0, 0, width, height);
  background.addColorStop(0, '#07111f');
  background.addColorStop(0.58, '#091827');
  background.addColorStop(1, '#050c15');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.save();
  context.globalAlpha = 0.06;
  context.strokeStyle = '#c4d9ef';
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 64) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }
  for (let y = 0; y <= height; y += 64) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
  context.restore();

  const glow = context.createRadialGradient(1180, 70, 10, 1180, 70, 330);
  glow.addColorStop(0, 'rgba(255, 173, 77, 0.24)');
  glow.addColorStop(1, 'rgba(255, 173, 77, 0)');
  context.fillStyle = glow;
  context.fillRect(850, 0, 550, 390);

  drawCanvasCard(context, padding, 46, 48, 48, {
    radius: 14,
    fill: '#ffad4d',
    stroke: null
  });
  context.fillStyle = '#07111f';
  context.font = '400 29px "DM Serif Display", Georgia, serif';
  context.textAlign = 'center';
  context.fillText('H', padding + 24, 80);

  context.textAlign = 'left';
  context.fillStyle = '#eef5ff';
  context.font = '800 20px Manrope, sans-serif';
  context.fillText('HISAAB', padding + 64, 78);
  context.fillStyle = '#ffbd69';
  context.font = '800 13px Manrope, sans-serif';
  context.fillText('FINAL SETTLEMENT', padding, 137);

  context.fillStyle = '#eef5ff';
  context.font = '400 55px "DM Serif Display", Georgia, serif';
  context.fillText(fitCanvasText(context, bill.eventName, 790), padding, 202);
  context.fillStyle = '#8190a5';
  context.font = '500 18px Manrope, sans-serif';
  context.fillText('A clear split of the table, taxes, and repayments.', padding, 238);

  context.textAlign = 'right';
  context.fillStyle = '#8190a5';
  context.font = '800 13px Manrope, sans-serif';
  context.fillText('CALCULATED TOTAL', width - padding, 137);
  context.fillStyle = '#ffc777';
  context.font = '800 48px Manrope, sans-serif';
  context.fillText(formatMoney(bill.totalPaise), width - padding, 195);
  context.fillStyle = '#a9b6c9';
  context.font = '600 16px Manrope, sans-serif';
  context.fillText(`Paid by ${bill.payerName}`, width - padding, 228);
  context.textAlign = 'left';

  context.strokeStyle = 'rgba(184, 210, 238, 0.14)';
  context.beginPath();
  context.moveTo(padding, 270);
  context.lineTo(width - padding, 270);
  context.stroke();

  const metricGap = 14;
  const metrics = [
    ['SUBTOTAL', formatMoney(bill.subtotalPaise)],
    [`GST${bill.gstEnabled ? ` · ${bill.gstRate}%` : ' · OFF'}`, formatMoney(bill.gstPaise)],
    [`PAID BY ${bill.payerName.toLocaleUpperCase('en-IN')}`, formatMoney(bill.amountPaidPaise)]
  ];
  const metricWidth = (
    width - padding * 2 - metricGap * (metrics.length - 1)
  ) / metrics.length;

  metrics.forEach(([label, value], index) => {
    const x = padding + index * (metricWidth + metricGap);
    const isPaymentMetric = index === metrics.length - 1;
    drawCanvasCard(context, x, 306, metricWidth, 126, {
      radius: 18,
      fill: isPaymentMetric ? 'rgba(67, 214, 181, 0.08)' : 'rgba(13, 32, 52, 0.88)',
      stroke: isPaymentMetric ? 'rgba(67, 214, 181, 0.24)' : 'rgba(184, 210, 238, 0.14)'
    });
    context.fillStyle = '#8190a5';
    context.font = '800 12px Manrope, sans-serif';
    context.fillText(fitCanvasText(context, label, metricWidth - 40), x + 20, 343);
    context.fillStyle = isPaymentMetric ? '#61e3c6' : '#eef5ff';
    context.font = '800 25px Manrope, sans-serif';
    context.fillText(value, x + 20, 390);
  });

  context.fillStyle = '#eef5ff';
  context.font = '800 14px Manrope, sans-serif';
  context.fillText('SHARE BY CONSUMPTION', padding, 474);

  drawCanvasCard(context, padding, tableTop, width - padding * 2, tableHeight, {
    radius: 22,
    fill: 'rgba(10, 27, 45, 0.92)',
    stroke: 'rgba(184, 210, 238, 0.15)',
    shadow: true
  });

  const columns = {
    person: padding + 28,
    food: 830,
    gst: 1050,
    total: width - padding - 28
  };
  context.fillStyle = '#748399';
  context.font = '800 12px Manrope, sans-serif';
  context.textAlign = 'left';
  context.fillText('PERSON', columns.person, tableTop + 34);
  context.textAlign = 'right';
  context.fillText('FOOD', columns.food, tableTop + 34);
  context.fillText('GST', columns.gst, tableTop + 34);
  context.fillText('TOTAL SHARE', columns.total, tableTop + 34);

  bill.people.forEach((person, index) => {
    const rowTop = tableTop + tableHeaderHeight + index * personRowHeight;
    if (index % 2 === 0) {
      context.fillStyle = 'rgba(255, 255, 255, 0.018)';
      context.fillRect(padding + 1, rowTop, width - padding * 2 - 2, personRowHeight);
    }
    context.strokeStyle = 'rgba(184, 210, 238, 0.09)';
    context.beginPath();
    context.moveTo(padding + 24, rowTop);
    context.lineTo(width - padding - 24, rowTop);
    context.stroke();

    context.beginPath();
    context.arc(columns.person + 18, rowTop + 36, 18, 0, Math.PI * 2);
    context.fillStyle = person.isPayer ? '#43d6b5' : '#76a9ff';
    context.fill();
    context.fillStyle = '#07111f';
    context.font = '800 14px Manrope, sans-serif';
    context.textAlign = 'center';
    context.fillText(getInitial(person.name).toLocaleUpperCase('en-IN'), columns.person + 18, rowTop + 41);

    context.textAlign = 'left';
    context.fillStyle = '#eef5ff';
    context.font = '700 18px Manrope, sans-serif';
    context.fillText(fitCanvasText(context, person.name, 370), columns.person + 50, rowTop + 42);
    if (person.isPayer) {
      const nameWidth = Math.min(context.measureText(person.name).width, 370);
      drawCanvasCard(context, columns.person + 60 + nameWidth, rowTop + 21, 66, 28, {
        radius: 14,
        fill: 'rgba(67, 214, 181, 0.12)',
        stroke: null
      });
      context.fillStyle = '#61e3c6';
      context.font = '800 10px Manrope, sans-serif';
      context.fillText('PAYER', columns.person + 76 + nameWidth, rowTop + 39);
    }

    context.textAlign = 'right';
    context.fillStyle = '#a9b6c9';
    context.font = '600 17px Manrope, sans-serif';
    context.fillText(formatMoney(person.consumptionPaise), columns.food, rowTop + 42);
    context.fillText(formatMoney(person.gstPaise), columns.gst, rowTop + 42);
    context.fillStyle = '#eef5ff';
    context.font = '800 18px Manrope, sans-serif';
    context.fillText(formatMoney(person.finalSharePaise), columns.total, rowTop + 42);
  });

  context.textAlign = 'left';
  context.fillStyle = '#eef5ff';
  context.font = '800 14px Manrope, sans-serif';
  context.fillText('WHO PAYS WHOM', padding, settlementTop - 26);

  const payerCardWidth = 390;
  drawCanvasCard(context, padding, settlementTop, payerCardWidth, settlementHeight, {
    radius: 22,
    fill: 'rgba(67, 214, 181, 0.09)',
    stroke: 'rgba(67, 214, 181, 0.26)'
  });
  context.fillStyle = '#8190a5';
  context.font = '800 12px Manrope, sans-serif';
  context.fillText('PAYER RECEIVES', padding + 26, settlementTop + 38);
  context.fillStyle = '#61e3c6';
  context.font = '800 34px Manrope, sans-serif';
  context.fillText(formatMoney(bill.reimbursement), padding + 26, settlementTop + 83);
  context.fillStyle = '#eef5ff';
  context.font = '700 18px Manrope, sans-serif';
  context.fillText(fitCanvasText(context, bill.payerName, payerCardWidth - 52), padding + 26, settlementTop + 119);
  context.fillStyle = '#8190a5';
  context.font = '500 14px Manrope, sans-serif';
  const ownShareLabel = bill.settlementRoundingEnabled ? 'Own share after rounding' : 'Own adjusted share';
  context.fillText(`${ownShareLabel}: ${formatMoney(bill.payerOwnShare)}`, padding + 26, settlementTop + 146);

  const transfersLeft = padding + payerCardWidth + 18;
  const transfersWidth = width - padding - transfersLeft;
  if (!transfers.length) {
    drawCanvasCard(context, transfersLeft, settlementTop, transfersWidth, 70, {
      radius: 17,
      fill: 'rgba(13, 32, 52, 0.88)'
    });
    context.fillStyle = '#a9b6c9';
    context.font = '700 17px Manrope, sans-serif';
    context.fillText('No transfers needed', transfersLeft + 22, settlementTop + 43);
  } else {
    transfers.forEach((person, index) => {
      const rowTop = settlementTop + index * 74;
      drawCanvasCard(context, transfersLeft, rowTop, transfersWidth, 64, {
        radius: 17,
        fill: 'rgba(13, 32, 52, 0.88)'
      });

      context.beginPath();
      context.arc(transfersLeft + 30, rowTop + 32, 16, 0, Math.PI * 2);
      context.fillStyle = '#76a9ff';
      context.fill();
      context.fillStyle = '#07111f';
      context.textAlign = 'center';
      context.font = '800 12px Manrope, sans-serif';
      context.fillText(getInitial(person.name).toLocaleUpperCase('en-IN'), transfersLeft + 30, rowTop + 37);

      context.textAlign = 'left';
      context.fillStyle = '#eef5ff';
      context.font = '700 16px Manrope, sans-serif';
      context.fillText(fitCanvasText(context, person.name, 330), transfersLeft + 58, rowTop + 27);
      context.fillStyle = '#748399';
      context.font = '500 12px Manrope, sans-serif';
      context.fillText(`pays ${bill.payerName}`, transfersLeft + 58, rowTop + 47);

      context.textAlign = 'right';
      context.fillStyle = '#ffc777';
      context.font = '800 20px Manrope, sans-serif';
      context.fillText(formatMoney(person.transferPaise), transfersLeft + transfersWidth - 22, rowTop + 39);
    });
  }

  if (hasAdjustmentNote) {
    const noteTop = settlementTop + settlementHeight + 18;
    drawCanvasCard(context, padding, noteTop, width - padding * 2, 56, {
      radius: 15,
      fill: 'rgba(118, 169, 255, 0.08)',
      stroke: 'rgba(118, 169, 255, 0.2)'
    });
    const notes = [];
    if (bill.settlementRoundingEnabled) {
      notes.push('Only repayment amounts are rounded to the nearest ₹1.');
    }
    if (bill.paymentDifference !== 0) {
      const direction = bill.paymentDifference < 0 ? 'less' : 'more';
      notes.push(`Actual payment was ${formatMoney(Math.abs(bill.paymentDifference))} ${direction} than the calculated total.`);
    }
    context.textAlign = 'left';
    context.fillStyle = '#a9b6c9';
    context.font = '600 14px Manrope, sans-serif';
    context.fillText(
      fitCanvasText(context, notes.join(' '), width - padding * 2 - 40),
      padding + 20,
      noteTop + 35
    );
  }

  context.strokeStyle = 'rgba(184, 210, 238, 0.14)';
  context.beginPath();
  context.moveTo(padding, footerTop - 30);
  context.lineTo(width - padding, footerTop - 30);
  context.stroke();
  context.textAlign = 'left';
  context.fillStyle = '#a9b6c9';
  context.font = '800 14px Manrope, sans-serif';
  context.fillText('HISAAB', padding, footerTop + 8);
  const creditPrefix = 'Made with';
  const creditSuffix = 'by A N I N D Y A';
  context.font = '600 14px Manrope, sans-serif';
  const prefixWidth = context.measureText(creditPrefix).width;
  context.font = '700 18px Manrope, sans-serif';
  const heartWidth = context.measureText('♥').width;
  context.font = '700 14px Manrope, sans-serif';
  const suffixWidth = context.measureText(creditSuffix).width;
  let creditX = width - padding - prefixWidth - heartWidth - suffixWidth - 18;
  context.textAlign = 'left';
  context.fillStyle = '#748399';
  context.font = '600 14px Manrope, sans-serif';
  context.fillText(creditPrefix, creditX, footerTop + 8);
  creditX += prefixWidth + 8;
  context.fillStyle = '#ff7d6f';
  context.font = '700 18px Manrope, sans-serif';
  context.fillText('♥', creditX, footerTop + 9);
  creditX += heartWidth + 10;
  context.fillStyle = '#a9b6c9';
  context.font = '700 14px Manrope, sans-serif';
  context.fillText(creditSuffix, creditX, footerTop + 8);

  return canvas;
}

async function exportBillImage(button) {
  if (!state.latestBill) return;

  const originalContent = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Preparing image…';

  try {
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = createBillCanvas(state.latestBill);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The bill image could not be created.');

    const safeEventName = state.latestBill.eventName
      .normalize('NFKD')
      .toLocaleLowerCase('en-IN')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'bill';
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `hisaab-${safeEventName}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  } catch (error) {
    console.error(error);
    elements.calculationFeedback.textContent = 'Could not export the bill image. Please try again.';
  } finally {
    button.disabled = false;
    button.innerHTML = originalContent;
  }
}

elements.personForm.addEventListener('submit', addPerson);
elements.itemForm.addEventListener('submit', addItem);
elements.billUpload.addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) scanBillImage(file);
});
elements.billCamera.addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) scanBillImage(file);
});
elements.clearScanButton.addEventListener('click', clearBillScan);
elements.scannedItemsList.addEventListener('input', updateScannedItem);
elements.importScannedButton.addEventListener('click', importScannedItems);

elements.peopleList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="remove-person"]');
  if (button) removePerson(Number(button.dataset.personId));
});

elements.itemList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="remove-item"]');
  if (button) removeItem(Number(button.dataset.itemId));
});

elements.itemList.addEventListener('change', (event) => {
  const target = event.target;
  const itemId = Number(target.dataset.itemId);
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return;

  if (target.dataset.action === 'change-mode') {
    item.mode = target.value;
    renderItems();
  }

  if (target.dataset.action === 'toggle-participant') {
    const personId = Number(target.dataset.personId);
    if (target.checked && !item.participantIds.includes(personId)) {
      item.participantIds.push(personId);
    } else if (!target.checked) {
      item.participantIds = item.participantIds.filter((id) => id !== personId);
    }
    renderItems();
    const refreshedPicker = elements.itemList.querySelector(
      `[data-item-card="${itemId}"] .people-picker`
    );
    if (refreshedPicker) refreshedPicker.open = true;
  }
});

elements.itemList.addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset.action !== 'custom-share') return;

  const itemId = Number(target.dataset.itemId);
  const personId = Number(target.dataset.personId);
  const item = state.items.find((candidate) => candidate.id === itemId);
  if (!item) return;

  item.customShares[personId] = target.value;
  updateCustomStatus(itemId);
});

elements.gstEnabled.addEventListener('change', syncGstControls);
elements.gstRate.addEventListener('input', updateBillPreview);
elements.roundOffEnabled.addEventListener('change', updateBillPreview);
elements.amountPaid.addEventListener('input', () => {
  state.payerAmountTouched = elements.amountPaid.value.trim() !== '';
});
elements.calculateButton.addEventListener('click', calculateBill);
elements.summaryContent.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="export-image"]');
  if (button) exportBillImage(button);
});
window.addEventListener('beforeunload', () => {
  if (state.billPreviewUrl) URL.revokeObjectURL(state.billPreviewUrl);
});

renderPeople();
renderPayerOptions();
renderItems();
syncGstControls();
