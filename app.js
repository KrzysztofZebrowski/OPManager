let routes = [];

try {
    const saved = localStorage.getItem('kurier_routes_v6');
    if (saved) routes = JSON.parse(saved);
} catch (e) {
    console.error("Błąd odczytu z pamięci telefonu", e);
}

if (!Array.isArray(routes) || routes.length === 0) {
    routes = [{ id: Date.now(), name: "Dzisiejsza trasa", addresses: [] }];
    localStorage.setItem('kurier_routes_v6', JSON.stringify(routes));
}

let currentRouteId = Number(localStorage.getItem('kurier_last_route_id'));

if (!currentRouteId || !routes.find(r => r.id === currentRouteId)) {
    currentRouteId = routes[0].id;
    localStorage.setItem('kurier_last_route_id', currentRouteId);
}

// --- CODZIENNA KONSERWACJA (ZWROTY, APM, STAŁE ADRESY) ---
function dailyMaintenance() {
    const todayStr = new Date().toDateString(); 
    const lastOpenDate = localStorage.getItem('kurier_last_open_date');
    const isNewDay = lastOpenDate !== todayStr;
    let modified = false;

    routes.forEach(route => {
        const initialLen = route.addresses.length;
        
        // Czyszczenie zwrotów z poprzednich dni
        route.addresses = route.addresses.filter(addr => {
            if (addr.type === 'zwrot') {
                const addrDateStr = new Date(addr.id).toDateString();
                return addrDateStr === todayStr; 
            }
            return true;
        });

        route.addresses.forEach(addr => {
            if (isNewDay && addr.isPermanent) {
                addr.done = false;
                modified = true;
            }
        });

        if (route.addresses.length !== initialLen) modified = true;
    });

    if (isNewDay) {
        localStorage.setItem('kurier_last_open_date', todayStr);
        modified = true;
    }

    if (modified) {
        localStorage.setItem('kurier_routes_v6', JSON.stringify(routes));
        console.log("Poranny reset wykonany: aktywowano stałe adresy na dzisiejszą trasę.");
    }
}
dailyMaintenance();

let currentFilter = 'all';

const views = {
    route: document.getElementById('view-route'),
    edit: document.getElementById('view-edit')
};

function getCurrentRoute() {
    return routes.find(r => r.id === currentRouteId) || routes[0];
}

function saveData() {
    localStorage.setItem('kurier_routes_v6', JSON.stringify(routes));
    localStorage.setItem('kurier_last_route_id', currentRouteId);
}

// --- ZARZĄDZANIE WIDOKAMI ---
function switchView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
}

function goToActive() { switchView('route'); renderActiveRoute(); }
function goToEdit() { switchView('edit'); renderEdit(); }

// --- 3. ALGORYTM GRUPOWANIA ---
function groupAddresses(addresses) {
    let cityGroups = []; 

    addresses.forEach(addr => {
        let city = (addr.city || '').trim().toLowerCase();
        let existingCity = cityGroups.find(g => g.city === city);
        if (existingCity) existingCity.items.push(addr);
        else cityGroups.push({ city: city, items: [addr], originalCity: addr.city });
    });

    let finalStructure = [];

    cityGroups.forEach(cg => {
        if (cg.items.length === 1) {
            finalStructure.push({ type: 'single', address: cg.items[0] });
        } else {
            let streetGroups = [];
            
            cg.items.forEach(addr => {
                let rawStreet = (addr.street || '').trim();
                let streetBase = rawStreet.replace(/\s+\d+[a-zA-Z\/-]*$/, '').toLowerCase();
                if (!streetBase) streetBase = rawStreet.toLowerCase(); 

                let existingStreet = streetGroups.find(g => g.streetBase === streetBase);
                if (existingStreet) {
                    existingStreet.items.push(addr);
                } else {
                    let displayStreet = rawStreet.replace(/\s+\d+[a-zA-Z\/-]*$/, '').trim();
                    streetGroups.push({ streetBase: streetBase, items: [addr], displayStreet: displayStreet || rawStreet });
                }
            });

            let cityGroupNode = { type: 'city-group', city: cg.originalCity || 'Brak miasta', children: [] };

            streetGroups.forEach(sg => {
                if (sg.items.length === 1) {
                    cityGroupNode.children.push({ type: 'single', address: sg.items[0] });
                } else {
                    cityGroupNode.children.push({ 
                        type: 'street-group', 
                        street: sg.displayStreet || 'Brak ulicy', 
                        children: sg.items.map(a => ({ type: 'single', address: a })) 
                    });
                }
            });
            finalStructure.push(cityGroupNode);
        }
    });

    return finalStructure;
}

// --- RENDEROWANIE DRZEWA I SORTOWANIE ---
let sortableInstances = [];

function initSortables() {
    sortableInstances.forEach(s => s.destroy());
    sortableInstances = [];

    if (currentFilter !== 'all') return;

    const lists = document.querySelectorAll('#active-list, .sortable-nested');
    lists.forEach(el => {
        sortableInstances.push(new Sortable(el, {
            handle: '.drag-handle',
            animation: 200,
            forceFallback: true,
            fallbackClass: "sortable-fallback",
            delay: 50,
            delayOnTouchOnly: true,
            onEnd: saveOrderFromDOM
        }));
    });
}

function saveOrderFromDOM() {
    const route = getCurrentRoute();
    const newOrderIds = Array.from(document.querySelectorAll('#active-list .address-item')).map(li => Number(li.dataset.id));
    const completedItems = route.addresses.filter(a => a.done);
    const activeItems = newOrderIds.map(id => route.addresses.find(addr => addr.id === id));
    
    route.addresses = [...activeItems, ...completedItems];
    saveData();
    if (navigator.vibrate) navigator.vibrate(40);
}

function createNodeElement(node) {
    if (node.type === 'single') return createAddressElement(node.address, false);
    
    const li = document.createElement('li');
    li.className = `group-container ${node.type === 'city-group' ? 'city-container' : 'street-container'}`;
    
    const count = node.type === 'city-group' ? 
        node.children.reduce((acc, child) => acc + (child.type === 'single' ? 1 : child.children.length), 0) : 
        node.children.length;

    const title = node.type === 'city-group' ? `📍 ${node.city} (${count})` : `🛣️ ${node.street} (${count})`;
    const rawName = node.type === 'city-group' ? node.city : node.street;
    const safeName = rawName.replace(/"/g, '&quot;').replace(/'/g, "\\'");

    li.innerHTML = `
        <div class="group-header">
            ${currentFilter === 'all' ? '<span class="drag-handle">☰</span>' : ''}
            <span class="group-title">${title}</span>
            <button class="qr-btn" onclick="showQRCode('${safeName}')">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="5" height="5" rx="1"></rect>
                    <rect x="16" y="3" width="5" height="5" rx="1"></rect>
                    <rect x="3" y="16" width="5" height="5" rx="1"></rect>
                    <path d="M21 16h-3a2 2 0 0 0-2 2v3"></path>
                    <path d="M21 21v.01"></path>
                    <path d="M12 7v3a2 2 0 0 1-2 2H7"></path>
                    <path d="M3 12h.01"></path>
                    <path d="M12 3h.01"></path>
                    <path d="M12 16v.01"></path>
                    <path d="M16 12h1"></path>
                    <path d="M21 12v.01"></path>
                    <path d="M12 21v-1"></path>
                </svg>
            </button>
            <button class="toggle-btn" onclick="toggleGroup(this)">▼</button>
        </div>
        <ul class="sortable-nested"></ul>
    `;

    const ul = li.querySelector('.sortable-nested');
    node.children.forEach(child => ul.appendChild(createNodeElement(child)));
    return li;
}

function createAddressElement(addr, isDone) {
    const li = document.createElement('li');
    li.className = isDone ? 'address-item is-done' : 'address-item';
    li.dataset.id = addr.id;

    const canDrag = !isDone && currentFilter === 'all';
    const typeNames = { apm: 'APM | POK', firma: 'Firma', zwykly: 'Zwykły', zwrot: 'Zwrot' };
    let fullAddress = addr.street;
    if(addr.city) fullAddress += `, ${addr.city}`;
    
    const safeName = (addr.name || '').replace(/"/g, '&quot;').replace(/'/g, "\\'");

    li.innerHTML = `
        ${canDrag ? '<div class="drag-handle">☰</div>' : ''}
        <div class="info">
            <span class="badge ${addr.type}">${typeNames[addr.type] || 'Inne'}</span>
            <span class="address-title">${addr.name || 'Brak nazwy'}</span>
            ${fullAddress ? `<span class="address-details">${fullAddress}</span>` : ''}
        </div>
        <div class="actions">
            <button class="qr-btn" style="margin-left: 0; margin-right: 6px;" onclick="showQRCode('${safeName}')">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="5" height="5" rx="1"></rect>
                    <rect x="16" y="3" width="5" height="5" rx="1"></rect>
                    <rect x="3" y="16" width="5" height="5" rx="1"></rect>
                    <path d="M21 16h-3a2 2 0 0 0-2 2v3"></path>
                    <path d="M21 21v.01"></path>
                    <path d="M12 7v3a2 2 0 0 1-2 2H7"></path>
                    <path d="M3 12h.01"></path>
                    <path d="M12 3h.01"></path>
                    <path d="M12 16v.01"></path>
                    <path d="M16 12h1"></path>
                    <path d="M21 12v.01"></path>
                    <path d="M12 21v-1"></path>
                </svg>
            </button>
            <button class="action-btn done" onclick="toggleDone(${addr.id})">${isDone ? '↩️' : '✓'}</button>
        </div>
    `;
    return li;
}

function renderActiveRoute() {
    const route = getCurrentRoute();
    document.getElementById('active-route-title').textContent = route.name;
    
    const activeListEl = document.getElementById('active-list');
    const completedListEl = document.getElementById('completed-list');
    
    activeListEl.innerHTML = '';
    completedListEl.innerHTML = '';
    
    let completedCount = 0;
    const activeAddresses = route.addresses.filter(a => !a.done && (currentFilter === 'all' || a.type === currentFilter));
    const completedAddresses = route.addresses.filter(a => a.done && (currentFilter === 'all' || a.type === currentFilter));
    
    const structuredData = groupAddresses(activeAddresses);
    structuredData.forEach(node => activeListEl.appendChild(createNodeElement(node)));

    completedAddresses.forEach(addr => {
        completedCount++;
        completedListEl.appendChild(createAddressElement(addr, true));
    });

    document.getElementById('completed-count').textContent = completedCount;
    initSortables();
}

function toggleDone(addrId) {
    const route = getCurrentRoute();
    const addr = route.addresses.find(a => a.id === addrId);
    if(addr) {
        addr.done = !addr.done;
        saveData();
        renderActiveRoute();
    }
}

function toggleGroup(button) {
    const container = button.closest('.group-container');
    if (container) container.classList.toggle('collapsed');
}

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        currentFilter = e.target.dataset.filter;
        renderActiveRoute();
    });
});

// --- EDYCJA TRASY I ZARZĄDZANIE ---
function renderEdit() {
    const routeSelect = document.getElementById('route-select');
    routeSelect.innerHTML = '';
    
    routes.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        if(r.id === currentRouteId) opt.selected = true;
        routeSelect.appendChild(opt);
    });

    const route = getCurrentRoute();
    const list = document.getElementById('edit-address-list');
    list.innerHTML = '';

    route.addresses.forEach(addr => {
        const li = document.createElement('li');
        li.className = 'address-item';
        
        const typeNames = { apm: 'APM | POK', firma: 'Firma', zwrot: 'Zwrot' };
        let fullAddress = addr.street;
        if(addr.city) fullAddress += `, ${addr.city}`;

        li.innerHTML = `
            <div class="info">
                <span class="badge ${addr.type}">${typeNames[addr.type] || 'Inne'}</span>
                <span class="address-title">${addr.name || 'Brak nazwy'}</span>
                ${fullAddress ? `<span class="address-details">${fullAddress}</span>` : ''}
            </div>
            <!-- Zmiana w sekcji akcji: przycisk Stały adres obok usuwania -->
            <div class="actions" style="gap: 8px;">
                <button class="btn-permanent ${addr.isPermanent ? 'active' : ''}" onclick="togglePermanent(${addr.id})">
                    ${addr.isPermanent ? '🔁 Stały' : '🔲 Stały'}
                </button>
                <button class="action-btn delete" onclick="deleteAddress(this, ${addr.id})">🗑️</button>
            </div>
        `;
        list.appendChild(li);
    });

    upddateWakeLockUI();
}

function changeRoute(newId) {
    currentRouteId = Number(newId);
    saveData();
    renderEdit();
}

// --- OBSŁUGA STAŁYCH ADRESÓW ---
function togglePermanent(addrId) {
    const route = getCurrentRoute();
    const addr = route.addresses.find(a => a.id === addrId);
    if (addr) {
        addr.isPermanent = !addr.isPermanent;
        saveData();
        renderEdit();
        if (navigator.vibrate) navigator.vibrate(20);
    }
}

// --- AUTOUZUPEŁNIANIE ---
let knownCities = [];
let knownStreets = [];

function extractKnownAddresses() {
    const citySet = new Set();
    const streetSet = new Set();

    routes.forEach(route => {
        route.addresses.forEach(addr => {
            if (addr.city) {
                let city = addr.city.trim();
                city = city.charAt(0).toUpperCase() + city.slice(1);
                citySet.add(city);
            }
            if (addr.street) {
                let streetBase = addr.street.replace(/\s+\d+[a-zA-Z\/-]*$/, '').trim();
                if (streetBase) {
                    streetBase = streetBase.charAt(0).toUpperCase() + streetBase.slice(1);
                    streetSet.add(streetBase);
                }
            }
        });
    });

    knownCities = Array.from(citySet);
    knownStreets = Array.from(streetSet);
}

function filterSuggestions(type) {
    const inputId = type === 'street' ? 'input-street' : 'input-city';
    const listId = type === 'street' ? 'street-suggestions' : 'city-suggestions';
    const data = type === 'street' ? knownStreets : knownCities;
    
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    const val = input.value.toLowerCase().trim();
    
    list.innerHTML = ''; 
    
    if (!val) {
        list.classList.add('hidden');
        return;
    }
    
    const matches = data.filter(item => item.toLowerCase().includes(val));
    
    if (matches.length === 0) {
        list.classList.add('hidden');
        return;
    }

    matches.forEach(match => {
        const li = document.createElement('li');
        li.textContent = match;
        
        li.onpointerdown = function(e) {
            e.preventDefault(); 
            input.value = match + (type === 'street' ? ' ' : '');
            list.classList.add('hidden');
        };
        
        list.appendChild(li);
    });
    
    list.classList.remove('hidden');
}

document.addEventListener('pointerdown', (e) => {
    if (e.target.id !== 'input-street') document.getElementById('street-suggestions').classList.add('hidden');
    if (e.target.id !== 'input-city') document.getElementById('city-suggestions').classList.add('hidden');
});

// --- OBSŁUGA MODALI ORAZ QR ---
function showAddRouteModal() { 
    document.getElementById('modal-route').classList.remove('hidden'); 
    document.getElementById('input-route-name').focus(); 
}

function showAddAddressModal() { 
    extractKnownAddresses(); 
    document.getElementById('modal-address').classList.remove('hidden'); 
    document.getElementById('input-name').focus(); 
}

function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
    document.querySelectorAll('input').forEach(i => i.value = '');
    document.getElementById('input-type').value = 'apm';
    document.getElementById('city-suggestions').classList.add('hidden');
    document.getElementById('street-suggestions').classList.add('hidden');
}

let qrCodeInstance = null;

// --- GENEROWANIE KODU QR
function showQRCode(text) {
    if (typeof QRious === 'undefined') {
        console.warn("Biblioteka QRious jeszcze się ładuje...");
        setTimeout(() => {
            if (typeof QRious === 'undefined') {
                alert("Błąd: Biblioteka QRious nie została załadowana. Sprawdź połączenie z internetem.");
            } else {
                showQRCode(text);
            }
        }, 150);
        return;
    }

    const utf8Text = unescape(encodeURIComponent(text));

    document.getElementById('qr-title').textContent = text.toUpperCase();
    document.getElementById('modal-qr').classList.remove('hidden');
    
    const container = document.getElementById('qrcode-container');
    container.innerHTML = '<canvas id="qr-canvas"></canvas>'; 
    const canvas = document.getElementById('qr-canvas');
    
    try {
        new QRious({
            element: canvas,
            value: utf8Text,
            size: 220,
            level: 'M',
            foreground: '#1f2937',
            background: '#ffffff'
        });
    } catch (error) {
        console.error("Błąd generowania QR (QRious):", error);
        container.innerHTML = '<p style="color: red; font-size: 14px; padding: 15px;">Nie udało się wygenerować kodu.</p>';
    }
}

function saveNewRoute() {
    const name = document.getElementById('input-route-name').value.trim();
    if (!name) return alert("Podaj nazwę trasy!");
    const newRoute = { id: Date.now(), name: name, addresses: [] };
    routes.push(newRoute);
    currentRouteId = newRoute.id; 
    saveData();
    closeModals();
    renderEdit();
}

let deleteRouteTimeout = null;
function deleteCurrentRoute(button) {
    if (routes.length <= 1) return alert("To twoja jedyna trasa. Nie możesz jej usunąć!");
    if (button.classList.contains('confirm')) {
        routes = routes.filter(r => r.id !== currentRouteId);
        currentRouteId = routes[0].id;
        saveData();
        renderEdit();
        clearTimeout(deleteRouteTimeout);
    } else {
        button.classList.add('confirm'); button.innerHTML = 'Na pewno?';
        deleteRouteTimeout = setTimeout(() => { button.classList.remove('confirm'); button.innerHTML = '🗑️ Usuń trasę'; }, 3000);
    }
}

// --- DODAWANIE ADRESU ---

function selectAddressType(type) {
    document.getElementById('input-type').value = type;
    
    let titleText = '';
    if (type === 'apm') titleText = '📦 APM | POK';
    if (type === 'firma') titleText = '🏢 Firma';
    if (type === 'zwrot') titleText = '↩️ Zwrot';
    
    document.getElementById('step-2-title').textContent = `Nowy punkt: ${titleText}`;
    document.getElementById('add-step-1').classList.add('hidden');
    document.getElementById('add-step-2').classList.remove('hidden');
}

function backToStep1() {
    document.getElementById('add-step-1').classList.remove('hidden');
    document.getElementById('add-step-2').classList.add('hidden');
}

function saveNewAddress() {
    const name = document.getElementById('input-name').value.trim();
    const type = document.getElementById('input-type').value;
    const street = document.getElementById('input-street').value.trim();
    const city = document.getElementById('input-city').value.trim();

    if (!name && !street) return alert("Podaj chociaż nazwę lub ulicę!");

    const route = getCurrentRoute();
    route.addresses.push({ id: Date.now(), name: name, type: type, street: street, city: city, done: false });
    saveData();
    renderEdit();
    closeModals();
}

let deleteAddrTimeout = null;
function deleteAddress(button, addrId) {
    if (button.classList.contains('confirm')) {
        const route = getCurrentRoute();
        route.addresses = route.addresses.filter(a => a.id !== addrId);
        saveData();
        renderEdit();
        clearTimeout(deleteAddrTimeout);
    } else {
        button.classList.add('confirm'); button.innerHTML = 'Tak';
        deleteAddrTimeout = setTimeout(() => { button.classList.remove('confirm'); button.innerHTML = '🗑️'; }, 3000);
    }
}

// --- ZABEZPIECZENIE PRZED WYGASZANIEM EKRANU (WAKE LOCK API) ---
let wakeLock = null;
let isWakeLockEnabled = localStorage.getItem('kurier_wakelock_enabled') !== 'false';

async function requestWakeLock() {
    if (!isWakeLockEnabled) return;
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('Wake Lock aktywny: Ekran nie zgaśnie.');
            
            wakeLock.addEventListener('release', () => {
                console.log('Wake Lock zwolniony.');
            });
        }
    } catch (err) {
        console.error(`Błąd Wake Lock: ${err.name}, ${err.message}`);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
        console.log('Wake Lock wyłączony na życzenie użytkownika.');
    }
}

function toggleWakeLock() {
    const switchInput = document.getElementById('switch-wakelock');
    if (!switchInput) return;
    
    isWakeLockEnabled = switchInput.checked; 
    localStorage.setItem('kurier_wakelock_enabled', isWakeLockEnabled);
    
    if (isWakeLockEnabled) {
        requestWakeLock();
    } else {
        releaseWakeLock();
    }
    
    if (navigator.vibrate) navigator.vibrate(20);
}

function updateWakeLockUI() {
    const switchInput = document.getElementById('switch-wakelock');
    if (switchInput) {
        switchInput.checked = isWakeLockEnabled;
    }
}

if (isWakeLockEnabled) requestWakeLock();

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isWakeLockEnabled) {
        requestWakeLock();
    }
});

// --- IMPORT I EKSPORT TRAS (KOPIA ZAPASOWA) ---

function exportRoutes() {
    if (routes.length === 0) return alert("Brak tras do zapisania!");

    const dataStr = JSON.stringify(routes, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const today = new Date().toISOString().slice(0, 10);
    const fileName = `kurier_kopia_tras_${today}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    if (navigator.vibrate) navigator.vibrate(20);
}

function triggerImport() {
    document.getElementById('input-import-file').click();
}

function importRoutes(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        let importedData;
        
        try {
            importedData = JSON.parse(e.target.result);
        } catch (err) {
            console.error("Błąd składni JSON:", err);
            alert("❌ Błąd: Wybrany plik nie jest poprawnym plikiem JSON.");
            event.target.value = '';
            return;
        }

        if (!Array.isArray(importedData) || importedData.length === 0) {
            alert("❌ Błąd: Plik nie zawiera listy tras!");
            event.target.value = '';
            return;
        }

        const isValidStructure = importedData.every(r => r && r.id && Array.isArray(r.addresses));
        if (!isValidStructure) {
            alert("❌ Błąd: Nieprawidłowy format tras (brak ID lub listy adresów).");
            event.target.value = '';
            return;
        }

        const confirmMsg = `Czy na pewno chcesz wgrać kopię zapasową?\n\nUwaga: Zastąpi ona Twoje obecne trasy (${routes.length} szt.) danymi z pliku (${importedData.length} szt.)!`;
        if (confirm(confirmMsg)) {
            try {
                routes = importedData;
                currentRouteId = Number(routes[0].id) || routes[0].id;
                saveData();
                renderEdit();
                if (typeof renderActiveRoute === 'function') renderActiveRoute();
                
                alert("✅ Kopia zapasowa została wgrana pomyślnie!");
                
                if (navigator.vibrate) {
                    try { navigator.vibrate([20, 50, 20]); } catch(e) {}
                }
            } catch (err) {
                console.error("Błąd odświeżania interfejsu po imporcie:", err);
                alert("⚠️ Dane zostały zaimportowane pomyślnie! Odśwież stronę, aby zobaczyć pełny widok.");
            }
        }
        
        event.target.value = '';
    };
    
    reader.readAsText(file);
}

// --- REJESTRACJA SERVICE WORKERA (PWA OFFLINE) ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(reg => console.log('✅ PWA gotowe (Service Worker aktywny):', reg.scope))
            .catch(err => console.error('❌ Błąd rejestracji PWA:', err));
    });
}

// --- START APLIKACJI ---
renderActiveRoute();