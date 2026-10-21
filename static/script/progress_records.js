// =========================================================
// SPASIS PROGRESS RECORDS - progress_records.js
//
// Flow:
// Division > District > Tehsil > Package
//
// Page open:
// - Top 5 stats = ALL database records
// - Table headings = visible
// - Table records = hidden
//
// Division select:
// - Division ke saare records
//
// District select:
// - Selected District ke saare records
//
// Tehsil select:
// - Selected Tehsil ke saare records
//
// Package select:
// - Selected Package ke records
// =========================================================

(function () {

    'use strict';


    // =====================================================
    // SETTINGS
    // =====================================================

    const PAGE_SIZE = 20;

    const FIELDS = [
        { id: 'prxDivision', key: 'division' },
        { id: 'prxDistrict', key: 'district' },
        { id: 'prxTehsil',   key: 'tehsil' },
        { id: 'prxPackage',  key: 'package_name' }
    ];

    const STATUS_COLORS = {
        completed:  '#237447',
        inprogress: '#1c5d86',
        hold:       '#d9822b',
        notstarted: '#8797a3'
    };


    // =====================================================
    // STATE
    // =====================================================

    let allRows = [];
    let filtered = [];

    let page = 1;

    let sel = {
        division: '',
        district: '',
        tehsil: '',
        package_name: ''
    };

    let loadFailed = false;

    let prxMap = null;
    let markerLayer = null;
    let markerById = {};


    // =====================================================
    // HELPERS
    // =====================================================

    const $ = id => document.getElementById(id);


    function esc(v) {
        return String(v ?? '').replace(/[&<>"']/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m]));
    }


    // Lahore / lahore / LAHORE / extra spaces
    // sab ko same maana jayega
    function norm(v) {
        return String(v ?? '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }


    function setText(id, value) {
        const el = $(id);

        if (el) {
            el.textContent = value ?? 0;
        }
    }


    function statusClass(v) {

        const s = norm(v);

        if (s === 'completed') {
            return 'completed';
        }

        if (s === 'in progress') {
            return 'inprogress';
        }

        if (s === 'on hold') {
            return 'hold';
        }

        return 'notstarted';
    }


    function plantKind(v) {

        const s = norm(v);

        if (
            /\bro\b/.test(s) ||
            s.includes('reverse')
        ) {
            return 'ro';
        }

        if (
            /\bmf\b/.test(s) ||
            s.includes('media')
        ) {
            return 'mf';
        }

        if (
            /\buf\b/.test(s) ||
            s.includes('ultra')
        ) {
            return 'uf';
        }

        return '';
    }


    // =====================================================
    // TABLE BOX SHOW / HIDE
    //
    // Page open:
    // table headings remain visible
    // rows are hidden
    //
    // Selection:
    // complete records table appears
    // =====================================================

    function getTableBox() {

        return (
            $('prxRecordsBox') ||
            document.querySelector('.prx-table-box')
        );
    }


    function showRecordRows() {

        const box = getTableBox();

        if (box) {
            box.style.display = 'block';
        }
    }


    function hideRecordRows() {

        const body = $('prxBody');

        if (body) {
            body.style.display = 'none';
        }
    }


    function showRecordBody() {

        const body = $('prxBody');

        if (body) {
            body.style.display = '';
        }
    }


    // =====================================================
    // LOAD DATA
    // =====================================================

    async function loadRecords() {

        loadFailed = false;

        try {

            const response = await fetch('/api/progress');

            if (!response.ok) {
                throw new Error('API error');
            }

            const data = await response.json();

            allRows = Array.isArray(data)
                ? data
                : [];

        } catch (error) {

            console.error(
                'Progress load error:',
                error
            );

            allRows = [];

            loadFailed = true;
        }


        // Dropdown options
        buildOptions();


        // Page initial state
        initializePage();
    }


    // =====================================================
    // INITIAL PAGE STATE
    // =====================================================

    function initializePage() {

        sel = {
            division: '',
            district: '',
            tehsil: '',
            package_name: ''
        };

        page = 1;

        filtered = [];


        // Dropdown reset
        resetDropdowns();


        // -------------------------------------------------
        // IMPORTANT:
        // Top 5 boxes ALL DATABASE RECORDS show karein
        // -------------------------------------------------

        renderStats(allRows);


        // RO / MF / UF bhi ALL records se
        renderPlantStats(allRows);


        // -------------------------------------------------
        // TABLE HEADINGS SHOW
        // RECORD ROWS HIDE
        // -------------------------------------------------

        renderTableHeadings();

        hideRecordRows();


        // -------------------------------------------------
        // Map initial page par empty rahega
        // -------------------------------------------------

        filtered = [];

        renderMap();
    }


    // =====================================================
    // RESET DROPDOWNS
    // =====================================================

    function resetDropdowns() {

        const division = $('prxDivision');
        const district = $('prxDistrict');
        const tehsil   = $('prxTehsil');
        const pkg      = $('prxPackage');


        if (division) {
            division.value = '';
        }

        if (district) {

            district.innerHTML =
                '<option value="">Select District</option>';

            district.value = '';
            district.disabled = true;
        }


        if (tehsil) {

            tehsil.innerHTML =
                '<option value="">Select Tehsil</option>';

            tehsil.value = '';
            tehsil.disabled = true;
        }


        if (pkg) {

            pkg.innerHTML =
                '<option value="">Select Package</option>';

            pkg.value = '';
            pkg.disabled = true;
        }
    }


    // =====================================================
    // FILTER MATCH
    // =====================================================

    function matches(row, skipKey = null) {

        return FIELDS.every(f => {

            if (f.key === skipKey) {
                return true;
            }

            if (!sel[f.key]) {
                return true;
            }

            return norm(row[f.key]) === sel[f.key];
        });
    }


    // =====================================================
    // BUILD FILTER OPTIONS
    //
    // Division:
    //   all divisions
    //
    // District:
    //   selected division ke districts
    //
    // Tehsil:
    //   selected district ke tehsils
    //
    // Package:
    //   selected tehsil ke packages
    // =====================================================

    function buildOptions() {

        const divisionEl = $('prxDivision');
        const districtEl = $('prxDistrict');
        const tehsilEl   = $('prxTehsil');
        const packageEl  = $('prxPackage');


        // -------------------------------------------------
        // DIVISION
        // -------------------------------------------------

        if (divisionEl) {

            const labels = new Map();

            allRows.forEach(row => {

                const key = norm(row.division);

                if (
                    key &&
                    !labels.has(key)
                ) {
                    labels.set(
                        key,
                        String(row.division).trim()
                    );
                }
            });


            const current = sel.division;

            divisionEl.innerHTML =
                '<option value="">Select Division</option>';


            [...labels.entries()]
                .sort((a, b) =>
                    a[1].localeCompare(b[1])
                )
                .forEach(([key, label]) => {

                    divisionEl.appendChild(
                        new Option(label, key)
                    );
                });


            divisionEl.value =
                labels.has(current)
                    ? current
                    : '';
        }


        // -------------------------------------------------
        // DISTRICT
        // -------------------------------------------------

        if (districtEl) {

            const labels = new Map();

            allRows
                .filter(row =>
                    !sel.division ||
                    norm(row.division) === sel.division
                )
                .forEach(row => {

                    const key = norm(row.district);

                    if (
                        key &&
                        !labels.has(key)
                    ) {
                        labels.set(
                            key,
                            String(row.district).trim()
                        );
                    }
                });


            const current = sel.district;

            districtEl.innerHTML =
                '<option value="">Select District</option>';


            [...labels.entries()]
                .sort((a, b) =>
                    a[1].localeCompare(b[1])
                )
                .forEach(([key, label]) => {

                    districtEl.appendChild(
                        new Option(label, key)
                    );
                });


            districtEl.value =
                labels.has(current)
                    ? current
                    : '';

            districtEl.disabled =
                !sel.division;
        }


        // -------------------------------------------------
        // TEHSIL
        // -------------------------------------------------

        if (tehsilEl) {

            const labels = new Map();

            allRows
                .filter(row =>
                    (!sel.division ||
                        norm(row.division) === sel.division) &&

                    (!sel.district ||
                        norm(row.district) === sel.district)
                )
                .forEach(row => {

                    const key = norm(row.tehsil);

                    if (
                        key &&
                        !labels.has(key)
                    ) {
                        labels.set(
                            key,
                            String(row.tehsil).trim()
                        );
                    }
                });


            const current = sel.tehsil;

            tehsilEl.innerHTML =
                '<option value="">Select Tehsil</option>';


            [...labels.entries()]
                .sort((a, b) =>
                    a[1].localeCompare(b[1])
                )
                .forEach(([key, label]) => {

                    tehsilEl.appendChild(
                        new Option(label, key)
                    );
                });


            tehsilEl.value =
                labels.has(current)
                    ? current
                    : '';

            tehsilEl.disabled =
                !sel.district;
        }


        // -------------------------------------------------
        // PACKAGE
        // -------------------------------------------------

        if (packageEl) {

            const labels = new Map();

            allRows
                .filter(row =>
                    (!sel.division ||
                        norm(row.division) === sel.division) &&

                    (!sel.district ||
                        norm(row.district) === sel.district) &&

                    (!sel.tehsil ||
                        norm(row.tehsil) === sel.tehsil)
                )
                .forEach(row => {

                    const key =
                        norm(row.package_name);

                    if (
                        key &&
                        !labels.has(key)
                    ) {
                        labels.set(
                            key,
                            String(
                                row.package_name
                            ).trim()
                        );
                    }
                });


            const current =
                sel.package_name;

            packageEl.innerHTML =
                '<option value="">Select Package</option>';


            [...labels.entries()]
                .sort((a, b) =>
                    a[1].localeCompare(b[1])
                )
                .forEach(([key, label]) => {

                    packageEl.appendChild(
                        new Option(label, key)
                    );
                });


            packageEl.value =
                labels.has(current)
                    ? current
                    : '';

            packageEl.disabled =
                !sel.tehsil;
        }
    }


    // =====================================================
    // APPLY FILTERS
    // =====================================================

    function applyFilters() {

        filtered = allRows.filter(row =>
            matches(row, null)
        );

        page = 1;


        // -------------------------------------------------
        // NOTHING SELECTED
        // -------------------------------------------------

        if (!sel.division) {

            // Top stats = ALL records
            renderStats(allRows);
            renderPlantStats(allRows);


            // Table headings visible
            renderTableHeadings();


            // Table rows hidden
            hideRecordRows();


            // Map empty
            renderMap();

            return;
        }


        // -------------------------------------------------
        // DIVISION / DISTRICT / TEHSIL / PACKAGE SELECTED
        // -------------------------------------------------

        renderStats(filtered);
        renderPlantStats(filtered);


        // Table rows visible
        showRecordRows();
        showRecordBody();


        // Table records
        renderTable();


        // Map selected records
        renderMap();
    }


    // =====================================================
    // STATS
    // =====================================================

    function distinctCount(
        key,
        rows
    ) {

        return new Set(
            rows
                .map(row => norm(row[key]))
                .filter(Boolean)
        ).size;
    }


    function renderStats(rows) {

        rows = Array.isArray(rows)
            ? rows
            : [];


        setText(
            'prxCntDivision',
            distinctCount(
                'division',
                rows
            )
        );


        setText(
            'prxCntDistrict',
            distinctCount(
                'district',
                rows
            )
        );


        setText(
            'prxCntTehsil',
            distinctCount(
                'tehsil',
                rows
            )
        );


        setText(
            'prxCntPackage',
            distinctCount(
                'package_name',
                rows
            )
        );


        setText(
            'prxCntRecords',
            rows.length
        );
    }


    // =====================================================
    // RO / MF / UF
    // =====================================================

    function renderPlantStats(rows) {

        rows = Array.isArray(rows)
            ? rows
            : [];


        const count = {
            ro: 0,
            mf: 0,
            uf: 0
        };


        rows.forEach(row => {

            const kind =
                plantKind(row.plant_type);

            if (kind) {
                count[kind]++;
            }
        });


        setText(
            'prxPlantRO',
            count.ro
        );

        setText(
            'prxPlantMF',
            count.mf
        );

        setText(
            'prxPlantUF',
            count.uf
        );
    }


    // =====================================================
    // TABLE HEADINGS
    //
    // Ye page open par bhi visible rahengi.
    // =====================================================

    function renderTableHeadings() {

        const head = $('prxHead');

        if (!head) {
            return;
        }


        head.innerHTML =
            '<tr>' +

                '<th>#</th>' +

                '<th>Division</th>' +

                '<th>District</th>' +

                '<th>Tehsil</th>' +

                '<th>Package</th>' +

                '<th>Site Name</th>' +

                '<th>Plant Type</th>' +

                '<th>Status</th>' +

                '<th>Start Date</th>' +

                '<th>Expected Completion</th>' +

                '<th>Latitude</th>' +

                '<th>Longitude</th>' +

                '<th>Remarks</th>' +

                '<th>Images</th>' +

            '</tr>';
    }

function renderImages(images) {
    let paths = [];

    try {
        if (Array.isArray(images)) {
            paths = images;
        } else if (typeof images === 'string' && images.trim()) {
            paths = JSON.parse(images);
        }
    } catch (error) {
        console.error('Images parse error:', error);
    }

    if (!Array.isArray(paths) || paths.length === 0) {
        return '<span class="prx-no-images">No Images</span>';
    }

    return paths.map(path => {
        if (typeof path !== 'string' || !path.trim()) {
            return '';
        }

        // Sirf apni website ke local static image paths allow karein.
        const cleanPath = path.trim();

        if (
            !cleanPath.startsWith('/static/uploads/progress_records/') ||
            cleanPath.includes('..')
        ) {
            return '';
        }

        const safePath = esc(cleanPath);

        return (
            '<a href="' + safePath + '" target="_blank" rel="noopener noreferrer">' +
                '<img src="' + safePath + '" ' +
                'alt="Progress photo" ' +
                'class="prx-record-image" ' +
                'loading="lazy">' +
            '</a>'
        );
    }).join('') || '<span class="prx-no-images">No Images</span>';
}
    // =====================================================
    // TABLE
    // =====================================================

    function renderTable() {

        const head =
            $('prxHead');

        const body =
            $('prxBody');

        const pager =
            $('prxPager');

        const bar =
            $('prxViewBar');


        if (!head || !body || !pager) {
            return;
        }


        // Headings
        renderTableHeadings();


        if (bar) {
            bar.innerHTML = '';
        }


        // -------------------------------------------------
        // NO RECORD
        // -------------------------------------------------

        if (!filtered.length) {

            body.innerHTML =
                '<tr>' +
                    '<td colspan="14" class="prx-empty">' +
                        (
                            loadFailed
                                ? 'Data load nahi ho saka. Server check karein.'
                                : 'Koi record nahi mila.'
                        ) +
                    '</td>' +
                '</tr>';


            pager.innerHTML = '';

            return;
        }


        // -------------------------------------------------
        // PAGINATION
        // -------------------------------------------------

        const totalPages =
            Math.ceil(
                filtered.length /
                PAGE_SIZE
            );


        if (page > totalPages) {
            page = totalPages;
        }


        const start =
            (page - 1) *
            PAGE_SIZE;


        const end =
            Math.min(
                start + PAGE_SIZE,
                filtered.length
            );


        const slice =
            filtered.slice(
                start,
                end
            );


        // -------------------------------------------------
        // RECORD ROWS
        // -------------------------------------------------

        body.innerHTML =
            slice.map((x, i) => {

                return (

                    '<tr data-id="' +
                        Number(x.id) +
                    '">' +

                        '<td>' +
                            (start + i + 1) +
                        '</td>' +

                        '<td>' +
                            esc(x.division) +
                        '</td>' +

                        '<td>' +
                            esc(x.district) +
                        '</td>' +

                        '<td>' +
                            esc(x.tehsil) +
                        '</td>' +

                        '<td>' +
                            esc(
                                x.package_name || ''
                            ) +
                        '</td>' +

                        '<td>' +
                            '<b>' +
                                esc(
                                    x.site_name
                                ) +
                            '</b>' +
                        '</td>' +

                        '<td>' +
                            esc(
                                x.plant_type || ''
                            ) +
                        '</td>' +

                        '<td>' +
                            '<span class="prx-pill ' +
                                statusClass(
                                    x.status
                                ) +
                            '">' +
                                esc(
                                    x.status || ''
                                ) +
                            '</span>' +
                        '</td>' +

                        '<td>' +
                            esc(
                                x.start_date || ''
                            ) +
                        '</td>' +

                        '<td>' +
                            esc(
                                x.end_date || ''
                            ) +
                        '</td>' +

                        '<td>' +
                            esc(
                                x.lat ?? ''
                            ) +
                        '</td>' +

                        '<td>' +
                            esc(
                                x.lng ?? ''
                            ) +
                        '</td>' +

                        '<td>' +
                            esc(x.remarks || '') +
                        '</td>' +

                        '<td class="prx-images-cell">' +
                            renderImages(x.images) +
                        '</td>' +

                    '</tr>'
                );

            }).join('');


        // -------------------------------------------------
        // PAGER
        // -------------------------------------------------

        pager.innerHTML =

            '<div>' +

                'Showing ' +

                '<strong>' +
                    (start + 1) +
                '</strong>' +

                ' - ' +

                '<strong>' +
                    end +
                '</strong>' +

                ' of ' +

                '<strong>' +
                    filtered.length +
                '</strong>' +

                ' records' +

            '</div>' +

            (
                totalPages > 1

                    ?

                    '<div class="prx-pager-buttons">' +

                        '<button type="button" ' +
                            'data-page="' +
                                (page - 1) +
                            '"' +
                            (
                                page <= 1
                                    ? ' disabled'
                                    : ''
                            ) +
                        '>' +
                            '◀ Previous' +
                        '</button>' +

                        '<span>' +

                            'Page ' +

                            '<strong>' +
                                page +
                            '</strong>' +

                            ' of ' +

                            '<strong>' +
                                totalPages +
                            '</strong>' +

                        '</span>' +

                        '<button type="button" ' +
                            'data-page="' +
                                (page + 1) +
                            '"' +
                            (
                                page >= totalPages
                                    ? ' disabled'
                                    : ''
                            ) +
                        '>' +

                            'Next ▶' +

                        '</button>' +

                    '</div>'

                    :

                    ''
            );
    }


    // =====================================================
    // MAP INIT
    // =====================================================

    function initMap() {

        const el =
            $('prxMap');


        if (
            !el ||
            !window.L
        ) {

            console.error(
                'Progress map: element ya Leaflet nahi mila.'
            );

            return;
        }


        prxMap =
            L.map(el).setView(
                [31.5204, 74.3587],
                7
            );


        L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            {
                attribution:
                    '© OpenStreetMap contributors'
            }
        ).addTo(prxMap);


        L.control.scale({
            imperial: false,
            position: 'bottomleft'
        }).addTo(prxMap);


        markerLayer =
            L.layerGroup().addTo(prxMap);


        setTimeout(
            () =>
                prxMap.invalidateSize(),
            300
        );
    }


    // =====================================================
    // MAP POPUP
    // =====================================================

    function popupHTML(x) {

        return (

            '<div style="min-width:190px">' +

                '<b>' +
                    esc(x.site_name) +
                '</b><br>' +

                esc(x.division) +
                ' / ' +
                esc(x.district) +
                ' / ' +
                esc(x.tehsil) +

                '<br>' +

                '<b>Package:</b> ' +
                    esc(
                        x.package_name ||
                        'N/A'
                    ) +

                '<br>' +

                '<b>Plant Type:</b> ' +
                    esc(
                        x.plant_type ||
                        'N/A'
                    ) +

                '<br>' +

                '<b>Status:</b> ' +
                    esc(
                        x.status ||
                        'N/A'
                    ) +

                '<br>' +

                esc(x.lat) +
                ', ' +
                esc(x.lng) +

            '</div>'
        );
    }


    // =====================================================
    // RENDER MAP
    // =====================================================

    function renderMap() {

        if (!prxMap || !markerLayer) {
            return;
        }


        markerLayer.clearLayers();

        markerById = {};


        const bounds = [];


        filtered.forEach(x => {

            const lat =
                parseFloat(x.lat);

            const lng =
                parseFloat(x.lng);


            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lng)
            ) {
                return;
            }


            const color =
                STATUS_COLORS[
                    statusClass(
                        x.status
                    )
                ];


            const marker =
                L.circleMarker(
                    [lat, lng],
                    {
                        radius: 7,
                        color: color,
                        fillColor: color,
                        fillOpacity: 0.9,
                        weight: 1
                    }
                ).bindPopup(
                    popupHTML(x)
                );


            marker.addTo(
                markerLayer
            );


            markerById[x.id] =
                marker;


            bounds.push([
                lat,
                lng
            ]);
        });


        // -------------------------------------------------
        // MAP ZOOM
        // -------------------------------------------------

        if (bounds.length === 1) {

            prxMap.setView(
                bounds[0],
                14
            );

        } else if (bounds.length > 1) {

            prxMap.fitBounds(
                bounds,
                {
                    padding: [30, 30],
                    maxZoom: 14
                }
            );

        } else {

            prxMap.setView(
                [31.5204, 74.3587],
                7
            );
        }
    }


    // =====================================================
    // FOCUS RECORD
    // =====================================================

    function focusRecord(id) {

        const marker =
            markerById[id];


        if (
            !marker ||
            !prxMap
        ) {
            return;
        }


        prxMap.setView(
            marker.getLatLng(),
            16
        );


        marker.openPopup();


        const mapEl =
            $('prxMap');


        if (mapEl) {

            mapEl.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }


    // =====================================================
    // DOWNLOAD LIST PDF
    // =====================================================

    function downloadListPDF() {

        try {

            if (
                !window.jspdf ||
                !window.jspdf.jsPDF
            ) {

                alert(
                    '❌ jsPDF library load nahi hui.'
                );

                return;
            }


            if (!filtered.length) {

                alert(
                    'List me koi record nahi hai.'
                );

                return;
            }


            const { jsPDF } =
                window.jspdf;


            const doc =
                new jsPDF({
                    orientation: 'landscape',
                    unit: 'mm',
                    format: 'a4'
                });


            doc.setFontSize(16);

            doc.setFont(
                undefined,
                'bold'
            );


            doc.text(
                'SPASIS Progress Records',
                10,
                12
            );


            doc.setFontSize(9);

            doc.setFont(
                undefined,
                'normal'
            );


            doc.text(
                'Total Records: ' +
                filtered.length +
                '   |   Generated: ' +
                new Date().toLocaleString(),
                10,
                18
            );


            const headers = [
                '#',
                'Division',
                'District',
                'Tehsil',
                'Package',
                'Site Name',
                'Plant',
                'Status',
                'Latitude',
                'Longitude'
            ];


            const widths = [
                8,
                26,
                28,
                28,
                28,
                45,
                24,
                24,
                33,
                33
            ];


            const startX = 10;

            const rowHeight = 8;

            let y = 24;


            function drawHeader() {

                let x =
                    startX;


                doc.setFontSize(7);

                doc.setFont(
                    undefined,
                    'bold'
                );


                headers.forEach(
                    (h, i) => {

                        doc.setFillColor(
                            11,
                            61,
                            98
                        );


                        doc.setDrawColor(
                            11,
                            61,
                            98
                        );


                        doc.rect(
                            x,
                            y,
                            widths[i],
                            rowHeight,
                            'FD'
                        );


                        doc.setTextColor(
                            255,
                            255,
                            255
                        );


                        doc.text(
                            h,
                            x + 2,
                            y + 5
                        );


                        x +=
                            widths[i];
                    }
                );


                doc.setFont(
                    undefined,
                    'normal'
                );


                doc.setTextColor(
                    0,
                    0,
                    0
                );


                y +=
                    rowHeight;
            }


            drawHeader();


            filtered.forEach(
                (item, index) => {

                    if (y > 190) {

                        doc.addPage();

                        y = 12;

                        drawHeader();
                    }


                    const row = [

                        index + 1,

                        item.division,

                        item.district,

                        item.tehsil,

                        item.package_name,

                        item.site_name,

                        item.plant_type,

                        item.status,

                        item.lat,

                        item.lng

                    ];


                    let x =
                        startX;


                    doc.setFontSize(7);


                    row.forEach(
                        (value, i) => {

                            doc.setDrawColor(
                                180,
                                180,
                                180
                            );


                            doc.rect(
                                x,
                                y,
                                widths[i],
                                rowHeight
                            );


                            const lines =
                                doc.splitTextToSize(
                                    String(
                                        value ?? ''
                                    ),
                                    widths[i] - 4
                                );


                            doc.text(
                                lines[0] || '',
                                x + 2,
                                y + 5
                            );


                            x +=
                                widths[i];
                        }
                    );


                    y +=
                        rowHeight;
                }
            );


            doc.save(
                'SPASIS_Progress_Records.pdf'
            );

        } catch (error) {

            console.error(
                'PDF error:',
                error
            );


            alert(
                '❌ PDF download nahi ho saka.\n\n' +
                error.message
            );
        }
    }


    // =====================================================
    // PRINT MAP
    // =====================================================

    function printMap() {

        if (!prxMap) {

            alert(
                'Map load nahi hua.'
            );

            return;
        }


        const center =
            prxMap.getCenter();


        const zoom =
            prxMap.getZoom();


        const points =
            filtered
                .filter(x =>
                    Number.isFinite(
                        parseFloat(x.lat)
                    ) &&
                    Number.isFinite(
                        parseFloat(x.lng)
                    )
                )
                .map(x => ({

                    lat:
                        parseFloat(x.lat),

                    lng:
                        parseFloat(x.lng),

                    color:
                        STATUS_COLORS[
                            statusClass(
                                x.status
                            )
                        ],

                    popup:
                        popupHTML(x)

                }));


        const w =
            window.open(
                '',
                '_blank',
                'width=1200,height=900'
            );


        if (!w) {

            alert(
                'Popup blocked hai. Browser me popup allow karein.'
            );

            return;
        }


        const safePoints =
            JSON.stringify(
                points
            ).replace(
                /</g,
                '\\u003c'
            );


        w.document.write(

            '<!DOCTYPE html>' +

            '<html>' +

            '<head>' +

                '<meta charset="UTF-8">' +

                '<title>' +
                    'SPASIS Progress Map' +
                '</title>' +

                '<link rel="stylesheet" ' +
                    'href="https://unpkg.com/leaflet/dist/leaflet.css">' +

                '<style>' +

                    'html,body{' +
                        'margin:0;' +
                        'height:100%' +
                    '}' +

                    '#m{' +
                        'width:100%;' +
                        'height:100vh' +
                    '}' +

                    '@media print{' +

                        '@page{' +
                            'size:landscape;' +
                            'margin:0' +
                        '}' +

                    '}' +

                '</style>' +

            '</head>' +

            '<body>' +

                '<div id="m"></div>' +

                '<script src="https://unpkg.com/leaflet/dist/leaflet.js"><\/script>' +

                '<script>' +

                    'var pts=' +
                        safePoints +
                    ';' +

                    'var m=' +
                        'L.map("m").setView([' +
                            center.lat +
                            ',' +
                            center.lng +
                        '],' +
                        zoom +
                    ');' +

                    'L.tileLayer(' +
                        '"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",' +
                        '{attribution:"© OpenStreetMap"}' +
                    ').addTo(m);' +

                    'pts.forEach(function(p){' +

                        'L.circleMarker(' +
                            '[p.lat,p.lng],' +
                            '{' +
                                'radius:7,' +
                                'color:p.color,' +
                                'fillColor:p.color,' +
                                'fillOpacity:.9,' +
                                'weight:1' +
                            '}' +
                        ')' +

                        '.addTo(m)' +

                        '.bindPopup(p.popup);' +

                    '});' +

                    'setTimeout(function(){' +

                        'm.invalidateSize();' +

                        'window.focus();' +

                        'window.print();' +

                    '},2500);' +

                '<\/script>' +

            '</body>' +

            '</html>'
        );


        w.document.close();
    }


    // =====================================================
    // EXPORT CSV
    // =====================================================

    function exportCSV() {

        if (!filtered.length) {

            alert(
                'Export ke liye koi record nahi hai.'
            );

            return;
        }


        const head = [

            'Division',
            'District',
            'Tehsil',
            'Package',
            'Site Name',
            'Plant Type',
            'Status',
            'Start Date',
            'Expected Completion',
            'Latitude',
            'Longitude',
            'GPS Accuracy',
            'Remarks',
            'Added On'

        ];


        const q = v =>
            '"' +
            String(v ?? '')
                .replace(/"/g, '""') +
            '"';


        const lines = [
            head.map(q).join(',')
        ];


        filtered.forEach(x => {

            lines.push([

                x.division,
                x.district,
                x.tehsil,
                x.package_name,
                x.site_name,
                x.plant_type,
                x.status,
                x.start_date,
                x.end_date,
                x.lat,
                x.lng,
                x.accuracy,
                x.remarks,
                x.created_at

            ].map(q).join(','));
        });


        const blob =
            new Blob(
                [
                    '\uFEFF' +
                    lines.join('\r\n')
                ],
                {
                    type:
                        'text/csv;charset=utf-8;'
                }
            );


        const link =
            document.createElement(
                'a'
            );


        link.href =
            URL.createObjectURL(
                blob
            );


        link.download =
            'SPASIS_Progress_Records.csv';


        document.body.appendChild(
            link
        );


        link.click();

        link.remove();


        setTimeout(
            () =>
                URL.revokeObjectURL(
                    link.href
                ),
            1000
        );
    }


    // =====================================================
    // EVENTS
    // =====================================================

    function bindEvents() {


        // -------------------------------------------------
        // DIVISION > DISTRICT > TEHSIL > PACKAGE
        // -------------------------------------------------

        FIELDS.forEach(
            (f, index) => {

                const el =
                    $(f.id);


                if (!el) {
                    return;
                }


                el.addEventListener(
                    'change',
                    e => {

                        const value =
                            e.target.value;


                        // -------------------------------------------------
                        // Selected value save
                        // -------------------------------------------------

                        sel[f.key] =
                            value;


                        // -------------------------------------------------
                        // Agar parent clear hua:
                        // child selections clear
                        // -------------------------------------------------

                        if (
                            f.key === 'division'
                        ) {

                            sel.district = '';
                            sel.tehsil = '';
                            sel.package_name = '';

                        } else if (
                            f.key === 'district'
                        ) {

                            sel.tehsil = '';
                            sel.package_name = '';

                        } else if (
                            f.key === 'tehsil'
                        ) {

                            sel.package_name = '';
                        }


                        // -------------------------------------------------
                        // Dropdowns rebuild
                        // -------------------------------------------------

                        buildOptions();


                        // -------------------------------------------------
                        // Records apply
                        // -------------------------------------------------

                        applyFilters();
                    }
                );
            }
        );


        // -------------------------------------------------
        // TABLE ROW CLICK
        // Map par record focus
        // -------------------------------------------------

        const body =
            $('prxBody');


        if (body) {

            body.addEventListener(
                'click',
                e => {

                    const recordRow =
                        e.target.closest(
                            'tr[data-id]'
                        );


                    if (recordRow) {

                        focusRecord(
                            Number(
                                recordRow.dataset.id
                            )
                        );
                    }
                }
            );
        }


        // -------------------------------------------------
        // PAGINATION
        // -------------------------------------------------

        const pager =
            $('prxPager');


        if (pager) {

            pager.addEventListener(
                'click',
                e => {

                    const btn =
                        e.target.closest(
                            'button[data-page]'
                        );


                    if (
                        btn &&
                        !btn.disabled
                    ) {

                        page =
                            Number(
                                btn.dataset.page
                            );


                        renderTable();


                        const tableBox =
                            document.querySelector(
                                '.prx-table-box'
                            );


                        if (tableBox) {

                            tableBox.scrollIntoView({
                                behavior: 'smooth',
                                block: 'start'
                            });
                        }
                    }
                }
            );
        }


        // -------------------------------------------------
        // PDF
        // -------------------------------------------------

        const pdf =
            $('prxBtnPDF');


        if (pdf) {
            pdf.addEventListener(
                'click',
                downloadListPDF
            );
        }


        // -------------------------------------------------
        // PRINT MAP
        // -------------------------------------------------

        const print =
            $('prxBtnPrint');


        if (print) {

            print.addEventListener(
                'click',
                printMap
            );
        }


        // -------------------------------------------------
        // CSV
        // -------------------------------------------------

        const csv =
            $('prxBtnCSV');


        if (csv) {

            csv.addEventListener(
                'click',
                exportCSV
            );
        }


        // -------------------------------------------------
        // REFRESH
        // -------------------------------------------------

        const refresh =
            $('prxBtnRefresh');


        if (refresh) {

            refresh.addEventListener(
                'click',
                () => {

                    // Page ko dobara initial state
                    // mein le jayein

                    initializePage();

                    // Fresh DB data
                    loadRecords();
                }
            );
        }
    }


    // =====================================================
    // START
    // =====================================================

    function start() {

        bindEvents();

        initMap();

        loadRecords();
    }


    if (
        document.readyState ===
        'loading'
    ) {

        document.addEventListener(
            'DOMContentLoaded',
            start
        );

    } else {

        start();
    }


})();