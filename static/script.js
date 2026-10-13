// =========================================================
// PSPA DASHBOARD - COMPLETE SCRIPT.JS
// =========================================================

// =========================================================
// GLOBAL VARIABLES
// =========================================================

let map = null;
let markers = [];
let currentData = [];
let shapefileLayers = [];

const RECORDS_PER_PAGE = 20;
let currentPage = 1;


// =========================================================
// PAGE LOAD
// =========================================================

window.onload = function () {

    loadCounts();
    initMap();

    resetPlantCountBoxes();

};


// =========================================================
// INIT MAP
// =========================================================

function initMap() {

    const mapElement = document.getElementById("map");

    if (!mapElement) {
        console.error("Map element not found.");
        return;
    }

    map = L.map("map").setView(
        [31.5204, 74.3587],
        10
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            attribution: "© OpenStreetMap"
        }
    ).addTo(map);

}


// =========================================================
// LOAD MAIN COUNTS
// =========================================================

function loadCounts() {

    fetch("/counts")

        .then(response => {

            if (!response.ok) {
                throw new Error("Counts API error");
            }

            return response.json();

        })

        .then(data => {

            setText(
                "divisionCount",
                data.divisions || 0
            );

            setText(
                "districtCount",
                data.districts || 0
            );

            setText(
                "tehsilCount",
                data.tehsils || 0
            );

            setText(
                "naCount",
                data.nas || 0
            );

            setText(
                "ppCount",
                data.pps || 0
            );

        })

        .catch(error => {

            console.error(
                "Load Counts Error:",
                error
            );

        });

}


// =========================================================
// LOAD DISTRICT
// =========================================================

function loadDistrict() {

    const division =
        document.getElementById("division")?.value || "";

    const district =
        document.getElementById("district");

    const tehsil =
        document.getElementById("tehsil");

    const na =
        document.getElementById("na");

    const pp =
        document.getElementById("pp");


    if (!district || !tehsil || !na || !pp) {
        return;
    }


    // Reset lower dropdowns

    district.innerHTML =
        `<option value="">Select District</option>`;

    tehsil.innerHTML =
        `<option value="">Select Tehsil</option>`;

    na.innerHTML =
        `<option value="">Select NA</option>`;

    pp.innerHTML =
        `<option value="">Select PP</option>`;


    resetPlantCountBoxes();


    if (!division) {

        currentData = [];

        resetTable();

        resetMarkers();

        resetShapefileLayers();

        loadCounts();

        return;

    }


    // -----------------------------------------------------
    // LOAD DISTRICTS
    // -----------------------------------------------------

    fetch(
        `/district/${encodeURIComponent(division)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error("District API error");
            }

            return response.json();

        })

        .then(data => {

            if (!Array.isArray(data)) {
                return;
            }

            data.forEach(d => {

                const option =
                    document.createElement("option");

                option.value = d;
                option.textContent = d;

                district.appendChild(option);

            });

        })

        .catch(error => {

            console.error(
                "District Error:",
                error
            );

        });


    // -----------------------------------------------------
    // LOAD DIVISION DATA
    // -----------------------------------------------------

    fetch(
        `/division_data/${encodeURIComponent(division)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error(
                    "Division data API error"
                );
            }

            return response.json();

        })

        .then(data => {

            currentData =
                Array.isArray(data) ? data : [];

            renderList(currentData);
            renderMap(currentData);

        })

        .catch(error => {

            console.error(
                "Division Data Error:",
                error
            );

        });


    updateFilteredCounts(division);

}


// =========================================================
// LOAD TEHSIL
// =========================================================

function loadTehsil() {

    const division =
        document.getElementById("division")?.value || "";

    const district =
        document.getElementById("district")?.value || "";

    const tehsilElement =
        document.getElementById("tehsil");

    const na =
        document.getElementById("na");

    const pp =
        document.getElementById("pp");


    if (
        !tehsilElement ||
        !na ||
        !pp
    ) {
        return;
    }


    tehsilElement.innerHTML =
        `<option value="">Select Tehsil</option>`;

    na.innerHTML =
        `<option value="">Select NA</option>`;

    pp.innerHTML =
        `<option value="">Select PP</option>`;


    resetPlantCountBoxes();


    if (!division || !district) {
        return;
    }


    // -----------------------------------------------------
    // LOAD DISTRICT DATA
    // -----------------------------------------------------

    fetch(
        `/district_data/${encodeURIComponent(district)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error(
                    "District data API error"
                );
            }

            return response.json();

        })

        .then(data => {

            currentData =
                Array.isArray(data) ? data : [];

            renderList(currentData);
            renderMap(currentData);

        })

        .catch(error => {

            console.error(
                "District Data Error:",
                error
            );

        });


    // -----------------------------------------------------
    // LOAD TEHSILS
    // -----------------------------------------------------

    fetch(
        `/tehsil/${encodeURIComponent(division)}/${encodeURIComponent(district)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error(
                    "Tehsil API error"
                );
            }

            return response.json();

        })

        .then(data => {

            if (!Array.isArray(data)) {
                return;
            }

            data.forEach(t => {

                const option =
                    document.createElement("option");

                option.value = t;
                option.textContent = t;

                tehsilElement.appendChild(option);

            });

        })

        .catch(error => {

            console.error(
                "Tehsil Error:",
                error
            );

        });


    updateFilteredCounts(
        division,
        district
    );

}


// =========================================================
// LOAD NA
// =========================================================

function loadNA() {

    const division =
        document.getElementById("division")?.value || "";

    const district =
        document.getElementById("district")?.value || "";

    const tehsil =
        document.getElementById("tehsil")?.value || "";

    const na =
        document.getElementById("na");

    const pp =
        document.getElementById("pp");


    if (!na || !pp) {
        return;
    }


    na.innerHTML =
        `<option value="">Select NA</option>`;

    pp.innerHTML =
        `<option value="">Select PP</option>`;


    resetPlantCountBoxes();


    if (
        !division ||
        !district ||
        !tehsil
    ) {
        return;
    }


    // -----------------------------------------------------
    // LOAD TEHSIL DATA
    // -----------------------------------------------------

    fetch(
        `/tehsil_data/${encodeURIComponent(division)}/${encodeURIComponent(district)}/${encodeURIComponent(tehsil)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error(
                    "Tehsil data API error"
                );
            }

            return response.json();

        })

        .then(data => {

            currentData =
                Array.isArray(data) ? data : [];

            renderList(currentData);
            renderMap(currentData);

        })

        .catch(error => {

            console.error(
                "Tehsil Data Error:",
                error
            );

        });


    // -----------------------------------------------------
    // LOAD NA LIST
    // -----------------------------------------------------

    fetch(
        `/na/${encodeURIComponent(division)}/${encodeURIComponent(district)}/${encodeURIComponent(tehsil)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error(
                    "NA API error"
                );
            }

            return response.json();

        })

        .then(data => {

            if (!Array.isArray(data)) {
                return;
            }

            data.forEach(n => {

                const option =
                    document.createElement("option");

                option.value = n;
                option.textContent = n;

                na.appendChild(option);

            });

        })

        .catch(error => {

            console.error(
                "NA Error:",
                error
            );

        });


    updateFilteredCounts(
        division,
        district,
        tehsil
    );

}


// =========================================================
// LOAD PP
// =========================================================

function loadPP() {

    const division =
        document.getElementById("division")?.value || "";

    const district =
        document.getElementById("district")?.value || "";

    const tehsil =
        document.getElementById("tehsil")?.value || "";

    const naValue =
        document.getElementById("na")?.value || "";

    const pp =
        document.getElementById("pp");


    if (!pp) {
        return;
    }


    pp.innerHTML =
        `<option value="">Select PP</option>`;


    resetPPPlantCount();


    if (
        !division ||
        !district ||
        !tehsil ||
        !naValue
    ) {
        return;
    }


    // -----------------------------------------------------
    // LOAD NA DATA
    // -----------------------------------------------------

    fetch(
        `/na_data/${encodeURIComponent(division)}/${encodeURIComponent(district)}/${encodeURIComponent(tehsil)}/${encodeURIComponent(naValue)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error(
                    "NA data API error"
                );
            }

            return response.json();

        })

        .then(data => {

            currentData =
                Array.isArray(data) ? data : [];

            renderList(currentData);
            renderMap(currentData);

            updateNACountFromData(
                currentData
            );
            loadMapBoundaries();
        })

        .catch(error => {

            console.error(
                "NA Data Error:",
                error
            );

            resetNACount();

        });


    // -----------------------------------------------------
    // LOAD PP LIST
    // -----------------------------------------------------

    fetch(
        `/pp/${encodeURIComponent(division)}/${encodeURIComponent(district)}/${encodeURIComponent(tehsil)}/${encodeURIComponent(naValue)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error(
                    "PP API error"
                );
            }

            return response.json();

        })

        .then(data => {

            if (!Array.isArray(data)) {
                return;
            }

            data.forEach(p => {

                const option =
                    document.createElement("option");

                option.value = p;
                option.textContent = p;

                pp.appendChild(option);

            });

        })

        .catch(error => {

            console.error(
                "PP Error:",
                error
            );

        });


    updateFilteredCounts(
        division,
        district,
        tehsil,
        naValue
    );

}


// =========================================================
// LOAD BOUNDARY / PP DATA
// =========================================================

function loadBoundary() {

    const division =
        document.getElementById("division")?.value || "";

    const district =
        document.getElementById("district")?.value || "";

    const tehsil =
        document.getElementById("tehsil")?.value || "";

    const na =
        document.getElementById("na")?.value || "";

    const pp =
        document.getElementById("pp")?.value || "";


    resetPPPlantCount();


    if (!pp) {
        return;
    }


    updateFilteredCounts(
        division,
        district,
        tehsil,
        na,
        pp
    );


    fetch(
        `/boundary/${encodeURIComponent(division)}/${encodeURIComponent(district)}/${encodeURIComponent(tehsil)}/${encodeURIComponent(na)}/${encodeURIComponent(pp)}`
    )

        .then(response => {

            if (!response.ok) {
                throw new Error(
                    "Boundary data could not be loaded"
                );
            }

            return response.json();

        })

        .then(data => {

            currentData =
                Array.isArray(data) ? data : [];

            renderList(currentData);
            renderMap(currentData);

            updatePPCountFromData(
                currentData
            );

        })

        .catch(error => {

            console.error(
                "Boundary Error:",
                error
            );

            resetPPPlantCount();

        });

}


// =========================================================
// RENDER TABLE
// =========================================================

function renderList(
    data,
    page = 1
) {

    const table =
        document.querySelector(".data-table");

    const tableBody =
        document.getElementById("boundary");


    if (!table || !tableBody) {
        return;
    }


    currentData =
        Array.isArray(data) ? data : [];


    if (
        !Number.isInteger(page) ||
        page < 1
    ) {
        page = 1;
    }


    const totalRecords =
        currentData.length;


    const totalPages =
        Math.ceil(
            totalRecords /
            RECORDS_PER_PAGE
        );


    if (
        totalPages > 0 &&
        page > totalPages
    ) {
        page = totalPages;
    }


    currentPage = page;


    // -----------------------------------------------------
    // TABLE HEADER
    // -----------------------------------------------------

    const thead =
        table.querySelector("thead");


    if (thead) {

        thead.innerHTML = `
            <tr>
                <th>#</th>
                <th>Division</th>
                <th>District</th>
                <th>Tehsil</th>
                <th>Site Name</th>
                <th>Executing Agency</th>
                <th>Installation</th>
                <th>NA</th>
                <th>PP</th>
                <th>Plant Type</th>
                <th>Category</th>
                <th>Latitude</th>
                <th>Longitude</th>
            </tr>
        `;

    }


    // -----------------------------------------------------
    // NO DATA
    // -----------------------------------------------------

    if (totalRecords === 0) {

        tableBody.innerHTML = `
            <tr>
                <td colspan="10">
                    No records found
                </td>
            </tr>
        `;

        renderPagination(0, 1);

        return;
    }


    const startIndex =
        (currentPage - 1) *
        RECORDS_PER_PAGE;


    const endIndex =
        Math.min(
            startIndex +
            RECORDS_PER_PAGE,
            totalRecords
        );


    const pageData =
        currentData.slice(
            startIndex,
            endIndex
        );


    tableBody.innerHTML = "";


    pageData.forEach(
        (d, index) => {

            const serialNumber =
                startIndex +
                index +
                1;


            tableBody.innerHTML += `
                <tr>

                    <td>${serialNumber}</td>

                    <td>
                        ${escapeHTML(d.division)}
                    </td>

                    <td>
                        ${escapeHTML(d.district)}
                    </td>

                    <td>
                        ${escapeHTML(d.tehsil)}
                    </td>

                    <td>
                        ${escapeHTML(
                            d.site_name ??
                            d.Site_Name ??
                            d["Site Name"] ??
                            ""
                        )}
                    </td>


                    <td>
                       ${escapeHTML(
                           d.executing_agency ??
                           d.Executing_Agency ??
                           d["Executing Agency"] ??
                           ""
                       )}
                   </td>

                   <td>
                       ${escapeHTML(
                           d.installation ??
                           d.Installation ??
                           ""
                       )}
                   </td>

                    <td>
                        ${escapeHTML(d.na)}
                    </td>

                    <td>
                        ${escapeHTML(d.pp)}
                    </td>

                    <td>
                        ${escapeHTML(
                            d.plant_type ??
                            d.Plant_Type ??
                            d["Plant Type"]
                        )}
                    </td>

                    <td>
                        ${escapeHTML(d.category)}
                    </td>

                    <td>
                        ${escapeHTML(d.lat)}
                    </td>

                    <td>
                        ${escapeHTML(d.lng)}
                    </td>

                </tr>
            `;

        }
    );


    renderPagination(
        totalRecords,
        totalPages
    );

}


// =========================================================
// PAGINATION
// =========================================================

function renderPagination(
    totalRecords,
    totalPages
) {

    let pagination =
        document.getElementById(
            "tablePagination"
        );


    if (!pagination) {

        pagination =
            document.createElement("div");

        pagination.id =
            "tablePagination";


        const tableContainer =
            document.querySelector(
                ".table-container"
            );


        if (tableContainer) {

            tableContainer.appendChild(
                pagination
            );

        }

    }


    if (!pagination) {
        return;
    }


    if (
        !totalRecords ||
        totalPages <= 1
    ) {

        pagination.innerHTML =
            totalRecords
                ? `
                    <div class="pagination-info">
                        Showing ${totalRecords} record(s)
                    </div>
                  `
                : "";

        return;
    }


    const start =
        (
            (currentPage - 1) *
            RECORDS_PER_PAGE
        ) + 1;


    const end =
        Math.min(
            currentPage *
            RECORDS_PER_PAGE,
            totalRecords
        );


    pagination.innerHTML = `

        <div class="pagination-wrapper">

            <div class="pagination-info">

                Showing
                <strong>${start}</strong>
                -
                <strong>${end}</strong>
                of
                <strong>${totalRecords}</strong>
                records

            </div>


            <div class="pagination-buttons">

                <button
                    type="button"
                    onclick="changePage(${currentPage - 1})"
                    ${currentPage === 1 ? "disabled" : ""}
                >
                    ◀ Previous
                </button>


                <span class="page-number">

                    Page
                    <strong>${currentPage}</strong>
                    of
                    <strong>${totalPages}</strong>

                </span>


                <button
                    type="button"
                    onclick="changePage(${currentPage + 1})"
                    ${currentPage === totalPages ? "disabled" : ""}
                >
                    Next ▶
                </button>

            </div>

        </div>

    `;

}


// =========================================================
// CHANGE PAGE
// =========================================================

function changePage(page) {

    if (
        !Array.isArray(currentData) ||
        currentData.length === 0
    ) {
        return;
    }


    const totalPages =
        Math.ceil(
            currentData.length /
            RECORDS_PER_PAGE
        );


    if (
        page < 1 ||
        page > totalPages
    ) {
        return;
    }


    currentPage = page;


    renderList(
        currentData,
        currentPage
    );


    const tableContainer =
        document.querySelector(
            ".table-container"
        );


    if (tableContainer) {

        tableContainer.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    }

}


// =========================================================
// RENDER MARKERS
// =========================================================


// =========================================================
// RENDER MARKERS
// =========================================================

function renderMap(data) {

    resetMarkers();

    if (
        !map ||
        !Array.isArray(data) ||
        data.length === 0
    ) {
        return;
    }

    let bounds = [];

    data.forEach(d => {

        const lat = parseFloat(d.lat);
        const lng = parseFloat(d.lng);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {
            return;
        }


        // -----------------------------------------------------
        // GET SITE NAME
        // -----------------------------------------------------

        const siteName =
            d.site_name ??
            d.Site_Name ??
            d["Site Name"] ??
            d.name ??
            "";


        // -----------------------------------------------------
        // GET PLANT TYPE
        // -----------------------------------------------------

        const plantType =
            d.plant_type ??
            d.Plant_Type ??
            d["Plant Type"] ??
            d["plant type"] ??
            "";


        // -----------------------------------------------------
        // GET CATEGORY
        // -----------------------------------------------------

        const category =
            d.category ??
            d.Category ??
            "";


        // -----------------------------------------------------
        // POPUP CONTENT
        // -----------------------------------------------------

        const popupHTML = `
            <div style="min-width: 180px;">

                <div style="margin-bottom: 6px;">
                    <strong>Site Name:</strong><br>
                    ${escapeHTML(siteName || "N/A")}
                </div>

                <div style="margin-bottom: 6px;">
                    <strong>Plant Type:</strong><br>
                    ${escapeHTML(plantType || "N/A")}
                </div>

                <div>
                    <strong>Category:</strong><br>
                    ${escapeHTML(category || "N/A")}
                </div>

            </div>
        `;


        // -----------------------------------------------------
        // CREATE MARKER
        // -----------------------------------------------------

        const marker =
            L.circleMarker(
                [lat, lng],
                {
                    radius: 7,
                    color: "green",
                    fillColor: "green",
                    fillOpacity: 0.9,
                    weight: 1
                }
            )
            .addTo(map)
            .bindPopup(popupHTML);

        markers.push(marker);

        bounds.push([lat, lng]);

    });


    // ---------------------------------------------------------
    // MAP ZOOM
    // ---------------------------------------------------------

    if (bounds.length === 1) {

        map.setView(
            bounds[0],
            14
        );

    }

    else if (bounds.length > 1) {

        map.fitBounds(
            bounds,
            {
                padding: [30, 30]
            }
        );

    }

}




// =========================================================
// RESET MARKERS
// =========================================================

function resetMarkers() {

    if (!map) {
        markers = [];
        return;
    }


    markers.forEach(
        marker => {

            if (
                map.hasLayer(marker)
            ) {
                map.removeLayer(marker);
            }

        }
    );


    markers = [];

}


// =========================================================
// RESET SHAPEFILE LAYERS
// =========================================================

function resetShapefileLayers() {

    if (!map) {
        shapefileLayers = [];
        return;
    }


    shapefileLayers.forEach(
        layer => {

            if (
                map.hasLayer(layer)
            ) {
                map.removeLayer(layer);
            }

        }
    );


    shapefileLayers = [];

}


// =========================================================
// RESET TABLE
// =========================================================

function resetTable() {

    const tableBody =
        document.getElementById(
            "boundary"
        );


    if (!tableBody) {
        return;
    }


    tableBody.innerHTML = `
        <tr>
            <td colspan="13">
                Please select a Division
            </td>
        </tr>
    `;


    const pagination =
        document.getElementById(
            "tablePagination"
        );


    if (pagination) {
        pagination.innerHTML = "";
    }

}


// =========================================================
// RESET ALL
// =========================================================

function resetAll() {

    const division =
        document.getElementById("division");

    const district =
        document.getElementById("district");

    const tehsil =
        document.getElementById("tehsil");

    const na =
        document.getElementById("na");

    const pp =
        document.getElementById("pp");


    if (division) {
        division.value = "";
    }


    if (district) {

        district.innerHTML =
            `<option value="">Select District</option>`;

    }


    if (tehsil) {

        tehsil.innerHTML =
            `<option value="">Select Tehsil</option>`;

    }


    if (na) {

        na.innerHTML =
            `<option value="">Select NA</option>`;

    }


    if (pp) {

        pp.innerHTML =
            `<option value="">Select PP</option>`;

    }


    currentData = [];
    currentPage = 1;


    resetTable();
    resetMarkers();
    resetShapefileLayers();
    resetPlantCountBoxes();

}


// =========================================================
// PLANT TYPE NORMALIZE
// =========================================================

function normalizePlantType(value) {

    if (
        value === null ||
        value === undefined
    ) {
        return "";
    }


    return String(value)
        .trim()
        .toUpperCase()
        .replace(/\s+/g, " ");

}


// =========================================================
// GET RO / MF / UF COUNTS
// =========================================================

function getPlantTypeCounts(data) {

    const counts = {
        RO: 0,
        MF: 0,
        UF: 0
    };


    if (!Array.isArray(data)) {
        return counts;
    }


    data.forEach(item => {

        const plantType =
            normalizePlantType(
                item.plant_type ??
                item.Plant_Type ??
                item["Plant Type"] ??
                item["plant type"]
            );


        if (plantType === "RO") {

            counts.RO++;

        }

        else if (plantType === "MF") {

            counts.MF++;

        }

        else if (plantType === "UF") {

            counts.UF++;

        }

    });


    return counts;

}


// =========================================================
// UPDATE NA PLANT COUNTS
// =========================================================

function updateNACountFromData(data) {

    const counts =
        getPlantTypeCounts(data);


    setText(
        "plantROCount",
        counts.RO
    );

    setText(
        "plantMFCount",
        counts.MF
    );

    setText(
        "plantUFCount",
        counts.UF
    );

}


// =========================================================
// UPDATE PP PLANT COUNTS
// =========================================================

function updatePPCountFromData(data) {

    const counts =
        getPlantTypeCounts(data);


    setText(
        "plantROCount",
        counts.RO
    );

    setText(
        "plantMFCount",
        counts.MF
    );

    setText(
        "plantUFCount",
        counts.UF
    );

}


// =========================================================
// RESET NA COUNT
// =========================================================

function resetNACount() {

    setText("plantROCount", 0);
    setText("plantMFCount", 0);
    setText("plantUFCount", 0);

}


// =========================================================
// RESET PP COUNT
// =========================================================

function resetPPPlantCount() {

    setText("plantROCount", 0);
    setText("plantMFCount", 0);
    setText("plantUFCount", 0);

}


// =========================================================
// RESET PLANT COUNT BOXES
// =========================================================

function resetPlantCountBoxes() {

    resetNACount();

}


// =========================================================
// UPDATE NA COUNT
// =========================================================

async function updateNACount() {

    const division =
        document.getElementById("division")?.value || "";

    const district =
        document.getElementById("district")?.value || "";

    const tehsil =
        document.getElementById("tehsil")?.value || "";

    const na =
        document.getElementById("na")?.value || "";


    if (
        !division ||
        !district ||
        !tehsil ||
        !na
    ) {

        resetNACount();

        return;

    }


    try {

        const response =
            await fetch(
                `/na_data/${encodeURIComponent(division)}/${encodeURIComponent(district)}/${encodeURIComponent(tehsil)}/${encodeURIComponent(na)}`
            );


        if (!response.ok) {
            throw new Error(
                "NA count data error"
            );
        }


        const data =
            await response.json();


        updateNACountFromData(
            Array.isArray(data)
                ? data
                : []
        );

    }

    catch (error) {

        console.error(
            "NA Count Error:",
            error
        );

        resetNACount();

    }

}


// =========================================================
// UPDATE PP COUNT
// =========================================================

async function updatePPCount() {

    const division =
        document.getElementById("division")?.value || "";

    const district =
        document.getElementById("district")?.value || "";

    const tehsil =
        document.getElementById("tehsil")?.value || "";

    const na =
        document.getElementById("na")?.value || "";

    const pp =
        document.getElementById("pp")?.value || "";


    if (
        !division ||
        !district ||
        !tehsil ||
        !na ||
        !pp
    ) {

        resetPPPlantCount();

        return;

    }


    try {

        const response =
            await fetch(
                `/boundary/${encodeURIComponent(division)}/${encodeURIComponent(district)}/${encodeURIComponent(tehsil)}/${encodeURIComponent(na)}/${encodeURIComponent(pp)}`
            );


        if (!response.ok) {
            throw new Error(
                "PP count data error"
            );
        }


        const data =
            await response.json();


        updatePPCountFromData(
            Array.isArray(data)
                ? data
                : []
        );

    }

    catch (error) {

        console.error(
            "PP Count Error:",
            error
        );

        resetPPPlantCount();

    }

}


// =========================================================
// FILTERED MAIN COUNTS
// =========================================================

function updateFilteredCounts(
    division = "",
    district = "",
    tehsil = "",
    na = "",
    pp = ""
) {

    const params =
        new URLSearchParams();


    params.set(
        "division",
        division
    );

    params.set(
        "district",
        district
    );

    params.set(
        "tehsil",
        tehsil
    );

    params.set(
        "na",
        na
    );

    params.set(
        "pp",
        pp
    );


    fetch(
        `/filtered_counts?${params.toString()}`
    )

        .then(response => {

            if (!response.ok) {

                throw new Error(
                    "Filtered counts API error"
                );

            }

            return response.json();

        })

        .then(data => {

            // Division selected

            if (
                division &&
                !district
            ) {

                setText(
                    "districtCount",
                    data.districts || 0
                );

                setText(
                    "tehsilCount",
                    0
                );

                setText(
                    "naCount",
                    0
                );

                setText(
                    "ppCount",
                    0
                );

            }


            // District selected

            else if (
                district &&
                !tehsil
            ) {

                setText(
                    "tehsilCount",
                    data.tehsils || 0
                );

                setText(
                    "naCount",
                    0
                );

                setText(
                    "ppCount",
                    0
                );

            }


            // Tehsil selected

            else if (
                district &&
                tehsil &&
                !na
            ) {

                setText(
                    "naCount",
                    data.nas || 0
                );

                setText(
                    "ppCount",
                    0
                );

            }


            // NA selected

            else if (
                district &&
                tehsil &&
                na &&
                !pp
            ) {

                setText(
                    "ppCount",
                    data.pps || 0
                );

            }


            // PP selected

            else if (
                district &&
                tehsil &&
                na &&
                pp
            ) {

            //    setText(
             //       "ppCount",
            //        data.plants || 0
            //    );

            }

        })

        .catch(error => {

            console.error(
                "Filtered Count Error:",
                error
            );

        });

}


// =========================================================
// SET TEXT
// =========================================================

function setText(
    id,
    value
) {

    const element =
        document.getElementById(id);


    if (element) {

        element.innerText =
            value ?? 0;

    }

}


// =========================================================
// EXCEL IMPORT - OPEN
// =========================================================

function openExcelImport() {

    const fileInput =
        document.getElementById(
            "excelFile"
        );


    if (!fileInput) {

        alert(
            "Excel file input nahi mila."
        );

        return;

    }


    fileInput.click();

}


// =========================================================
// EXCEL IMPORT - UPLOAD
// =========================================================

function uploadExcel() {

    const fileInput =
        document.getElementById(
            "excelFile"
        );


    if (
        !fileInput ||
        !fileInput.files.length
    ) {
        return;
    }


    const file =
        fileInput.files[0];


    const extension =
        file.name
            .split(".")
            .pop()
            .toLowerCase();


    if (
        !["xlsx", "xls"].includes(
            extension
        )
    ) {

        alert(
            "❌ Sirf Excel file (.xlsx / .xls) select karein."
        );

        fileInput.value = "";

        return;

    }


    const formData =
        new FormData();


    formData.append(
        "file",
        file
    );


    const importButton =
        document.querySelector(
            'button[onclick="openExcelImport()"]'
        );


    if (importButton) {

        importButton.disabled = true;

        importButton.innerText =
            "⏳ Importing...";

    }


    showLoadingMessage(
        "Excel import ho rahi hai..."
    );


    fetch(
        "/import_excel",
        {
            method: "POST",
            body: formData
        }
    )

        .then(async response => {

            let data;

            try {

                data =
                    await response.json();

            }

            catch (error) {

                throw new Error(
                    "Server ne valid JSON response nahi diya."
                );

            }


            if (!response.ok) {

                throw new Error(
                    data.message ||
                    "Server ne import request reject kar di."
                );

            }


            return data;

        })

        .then(data => {

            if (!data.success) {

                let message =
                    "❌ Import failed\n\n" +
                    (
                        data.message ||
                        "Unknown error"
                    );


                if (
                    data.missing_columns &&
                    data.missing_columns.length
                ) {

                    message +=
                        "\n\nMissing Columns:\n" +
                        data.missing_columns.join(
                            "\n"
                        );

                }


                alert(message);

                return;

            }


            let message =
                "✅ Excel Import Complete\n\n";


            message +=
                "Total Rows: " +
                (data.total_rows || 0);


            message +=
                "\n\nInserted: " +
                (data.inserted || 0);


            message +=
                "\nUpdated: " +
                (data.updated || 0);


            message +=
                "\nDuplicates: " +
                (data.duplicates || 0);


            message +=
                "\nInvalid: " +
                (data.invalid || 0);


            if (
                data.errors &&
                data.errors.length
            ) {

                message +=
                    "\n\nInvalid Rows:\n" +
                    data.errors.join(
                        "\n"
                    );

            }


            alert(message);


            // Refresh counts

            loadCounts();


            // Reset dashboard

            resetAll();


            // Reload page

            setTimeout(
                () => {
                    location.reload();
                },
                500
            );

        })

        .catch(error => {

            console.error(
                "Excel Import Error:",
                error
            );


            alert(
                "❌ Excel import ke waqt error aa gaya.\n\n" +
                error.message
            );

        })

        .finally(() => {

            hideLoadingMessage();


            if (importButton) {

                importButton.disabled =
                    false;

                importButton.innerText =
                    "📊 Import Excel";

            }


            fileInput.value = "";

        });

}


// =========================================================
// PDF REPORT
// =========================================================

function downloadListPDF() {

    try {

        if (
            !window.jspdf ||
            !window.jspdf.jsPDF
        ) {

            alert(
                "❌ jsPDF library load nahi hui."
            );

            return;

        }


        const {
            jsPDF
        } = window.jspdf;


        const doc =
            new jsPDF({
                orientation: "landscape",
                unit: "mm",
                format: "a4"
            });


        doc.setFontSize(16);
        doc.setFont(undefined, "bold");

        doc.text(
            "PSPA Detailed Report",
            10,
            12
        );


        doc.setFontSize(9);
        doc.setFont(undefined, "normal");

        doc.text(
            `Total Records: ${
                Array.isArray(currentData)
                    ? currentData.length
                    : 0
            }`,
            10,
            18
        );


        if (
            !Array.isArray(currentData) ||
            currentData.length === 0
        ) {

            doc.setFontSize(12);

            doc.text(
                "No data available",
                10,
                30
            );


            safePDFSave(
                doc,
                "PSPA_Detailed_Report.pdf"
            );

            return;

        }


        const headers = [
            "#",
            "Division",
            "District",
            "Tehsil",
            "NA",
            "PP",
            "Plant Type",
            "Category",
            "Latitude",
            "Longitude"
        ];


        const colWidth = [
            7,
            25,
            30,
            30,
            25,
            25,
            30,
            27,
            30,
            30
        ];


        const startX = 10;
        const rowHeight = 8;

        let y = 25;


        function drawHeader() {

            let x = startX;


            doc.setFontSize(7);
            doc.setFont(
                undefined,
                "bold"
            );


            headers.forEach(
                (header, index) => {

                    doc.setFillColor(
                        230,
                        230,
                        230
                    );

                    doc.setDrawColor(
                        120,
                        120,
                        120
                    );


                    doc.rect(
                        x,
                        y,
                        colWidth[index],
                        rowHeight,
                        "FD"
                    );


                    doc.setTextColor(
                        0,
                        0,
                        0
                    );


                    doc.text(
                        String(header),
                        x + 2,
                        y + 5
                    );


                    x +=
                        colWidth[index];

                }
            );


            doc.setFont(
                undefined,
                "normal"
            );


            y += rowHeight;

        }


        drawHeader();


        currentData.forEach(
            (item, index) => {

                if (y > 185) {

                    doc.addPage();

                    y = 15;

                    drawHeader();

                }


                const row = [

                    index + 1,

                    item.division ?? "",

                    item.district ?? "",

                    item.tehsil ?? "",

                    item.na ?? "",

                    item.pp ?? "",

                    item.plant_type ??
                    item.Plant_Type ??
                    item["Plant Type"] ??
                    "",

                    item.category ?? "",

                    item.lat ?? "",

                    item.lng ?? ""

                ];


                let x = startX;


                doc.setFontSize(7);


                row.forEach(
                    (value, colIndex) => {

                        doc.setDrawColor(
                            180,
                            180,
                            180
                        );


                        doc.rect(
                            x,
                            y,
                            colWidth[colIndex],
                            rowHeight
                        );


                        const text =
                            String(
                                value ?? ""
                            );


                        const maxWidth =
                            colWidth[colIndex] -
                            4;


                        const splitText =
                            doc.splitTextToSize(
                                text,
                                maxWidth
                            );


                        doc.text(
                            splitText[0] || "",
                            x + 2,
                            y + 5
                        );


                        x +=
                            colWidth[colIndex];

                    }
                );


                y += rowHeight;

            }
        );


        safePDFSave(
            doc,
            "PSPA_Detailed_Report.pdf"
        );

    }

    catch (error) {

        console.error(
            "PDF Download Error:",
            error
        );


        alert(
            "❌ PDF download nahi ho saka.\n\n" +
            error.message
        );

    }

}


// =========================================================
// SAFE PDF SAVE
// =========================================================

function safePDFSave(
    doc,
    filename
) {

    try {

        doc.save(filename);

    }

    catch (error) {

        console.error(
            "Normal PDF save failed:",
            error
        );


        try {

            const blob =
                doc.output("blob");


            const url =
                URL.createObjectURL(
                    blob
                );


            const link =
                document.createElement(
                    "a"
                );


            link.href = url;
            link.download = filename;


            document.body.appendChild(
                link
            );


            link.click();


            document.body.removeChild(
                link
            );


            setTimeout(
                () => {
                    URL.revokeObjectURL(
                        url
                    );
                },
                1000
            );

        }

        catch (fallbackError) {

            console.error(
                "PDF fallback failed:",
                fallbackError
            );


            alert(
                "❌ PDF download failed.\n\n" +
                fallbackError.message
            );

        }

    }

}


// =========================================================
// 🖨️ PRINT MAP ONLY
// =========================================================

function printMap() {

    if (!map) {

        alert(
            "Map load nahi hua."
        );

        return;

    }


    const center =
        map.getCenter();

    const zoom =
        map.getZoom();


    const printWindow =
        window.open(
            "",
            "_blank",
            "width=1200,height=900"
        );


    if (!printWindow) {

        alert(
            "Popup blocked hai. Browser mein popup allow karein."
        );

        return;

    }


    // =====================================================
    // GET CURRENT MAP LAYERS
    // =====================================================

    const mapLayers = [];


    // Markers

    markers.forEach(
        marker => {

            try {

                const latLng =
                    marker.getLatLng();

                const popup =
                    marker.getPopup();


                mapLayers.push({
                    type: "marker",
                    lat: latLng.lat,
                    lng: latLng.lng,
                    popup:
                        popup
                            ? popup.getContent()
                            : ""
                });

            }

            catch (error) {

                console.error(
                    "Marker print error:",
                    error
                );

            }

        }
    );


    // Shapefile polygons

    shapefileLayers.forEach(
        layer => {

            try {

                if (
                    !layer ||
                    !layer.getLayers
                ) {
                    return;
                }


                layer.eachLayer(
                    subLayer => {

                        if (
                            subLayer.getLatLngs
                        ) {

                            mapLayers.push({
                                type: "polygon",
                                latlngs:
                                    subLayer.getLatLngs(),
                                popup:
                                    subLayer.getPopup()
                                        ? subLayer
                                            .getPopup()
                                            .getContent()
                                        : ""
                            });

                        }

                    }
                );

            }

            catch (error) {

                console.error(
                    "Polygon print error:",
                    error
                );

            }

        }
    );


    // =====================================================
    // PRINT WINDOW
    // ONLY MAP EXISTS
    // =====================================================

    printWindow.document.write(`

        <!DOCTYPE html>

        <html>

        <head>

            <title>PSPA Map</title>

            <meta charset="UTF-8">

            <meta
                name="viewport"
                content="width=device-width,
                         initial-scale=1.0"
            >


            <link
                rel="stylesheet"
                href="https://unpkg.com/leaflet/dist/leaflet.css"
            >


            <style>

                html,
                body {

                    margin: 0;
                    padding: 0;

                    width: 100%;
                    height: 100%;

                    overflow: hidden;

                }


                #printMap {

                    width: 100%;
                    height: 100vh;

                }


                @media print {

                    @page {

                        size: landscape;
                        margin: 0;

                    }


                    html,
                    body {

                        width: 100%;
                        height: 100%;

                        margin: 0;
                        padding: 0;

                    }


                    #printMap {

                        width: 100%;
                        height: 100vh;

                    }

                }

            </style>

        </head>


        <body>

            <!-- ONLY MAP -->

            <div id="printMap"></div>


            <script
                src="https://unpkg.com/leaflet/dist/leaflet.js">
            <\/script>


            <script>

                const printMap =
                    L.map("printMap").setView(
                        [
                            ${center.lat},
                            ${center.lng}
                        ],
                        ${zoom}
                    );


                L.tileLayer(
                    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    {
                        attribution:
                            "© OpenStreetMap"
                    }
                ).addTo(
                    printMap
                );


                const mapLayers =
                    ${JSON.stringify(mapLayers)};


                // =========================================
                // ADD MARKERS
                // =========================================

                mapLayers.forEach(
                    item => {

                        if (
                            item.type === "marker"
                        ) {

                            L.marker(
                                [
                                    item.lat,
                                    item.lng
                                ]
                            )
                            .addTo(printMap)
                            .bindPopup(
                                item.popup || ""
                            );

                        }

                    }
                );


                // =========================================
                // ADD POLYGONS
                // =========================================

                function drawPolygon(
                    latlngs
                ) {

                    if (
                        !Array.isArray(latlngs)
                    ) {
                        return;
                    }


                    // Leaflet nested LatLng arrays

                    const converted =
                        latlngs.map(
                            item => {

                                if (
                                    Array.isArray(item)
                                ) {

                                    return drawPolygon(
                                        item
                                    );

                                }


                                if (
                                    item &&
                                    typeof item.lat ===
                                    "number" &&
                                    typeof item.lng ===
                                    "number"
                                ) {

                                    return [
                                        item.lat,
                                        item.lng
                                    ];

                                }


                                return item;

                            }
                        );


                    return converted;

                }


                mapLayers.forEach(
                    item => {

                        if (
                            item.type ===
                            "polygon"
                        ) {

                            try {

                                const polygon =
                                    L.polygon(
                                        drawPolygon(
                                            item.latlngs
                                        ),
                                        {
                                            weight: 2,
                                            fillOpacity: 0.12
                                        }
                                    )
                                    .addTo(
                                        printMap
                                    );


                                if (
                                    item.popup
                                ) {

                                    polygon.bindPopup(
                                        item.popup
                                    );

                                }

                            }

                            catch (error) {

                                console.error(
                                    "Polygon error:",
                                    error
                                );

                            }

                        }

                    }
                );


                // =========================================
                // PRINT
                // =========================================

                setTimeout(
                    function () {

                        printMap.invalidateSize();

                        window.focus();

                        window.print();

                    },
                    2500
                );

            <\/script>

        </body>

        </html>

    `);


    printWindow.document.close();

}


// =========================================================
// OPEN SHAPEFILE IMPORT
// =========================================================

function openShapefileImport() {

    const input =
        document.getElementById(
            "shapefileFiles"
        );


    if (!input) {

        alert(
            "Shapefile input nahi mila."
        );

        return;

    }


    input.click();

}


// =========================================================
// UPLOAD SHAPEFILES
// =========================================================

async function uploadShapefiles() {

    const input =
        document.getElementById(
            "shapefileFiles"
        );


    if (
        !input ||
        !input.files.length
    ) {
        return;
    }


    const files =
        Array.from(
            input.files
        );


    for (const file of files) {

        if (
            !file.name
                .toLowerCase()
                .endsWith(".zip")
        ) {

            alert(
                "Sirf ZIP shapefile packages allowed hain."
            );

            input.value = "";

            return;

        }

    }


    const formData =
        new FormData();


    files.forEach(
        file => {

            formData.append(
                "files",
                file
            );

        }
    );


    showLoadingMessage(
        "Shapefiles import ho rahi hain..."
    );


    try {

        const response =
            await fetch(
                "/import_shapefiles",
                {
                    method: "POST",
                    body: formData
                }
            );


        const result =
            await response.json();


        if (!response.ok) {

            throw new Error(
                result.message ||
                "Shapefile import failed."
            );

        }


        if (!result.success) {

            alert(
                result.message ||
                "Shapefile import failed."
            );

            return;

        }


        let message =
            "✅ Shapefile Import Complete\n\n";


        message +=
            "Inserted: " +
            (result.inserted || 0);


        message +=
            "\nUpdated: " +
            (result.updated || 0);


        message +=
            "\nDuplicates: " +
            (result.duplicates || 0);


        message +=
            "\nInvalid: " +
            (result.invalid || 0);


        if (
            result.errors &&
            result.errors.length
        ) {

            message +=
                "\n\nErrors:\n" +
                result.errors.join(
                    "\n"
                );

        }


        alert(message);


        loadCounts();


        // Refresh current selection

        const pp =
            document.getElementById(
                "pp"
            )?.value || "";


        if (pp) {

            loadBoundary();

        }

        else {

            loadMapBoundaries();

        }

    }

    catch (error) {

        console.error(
            "Shapefile import error:",
            error
        );


        alert(
            "❌ Server error:\n\n" +
            error.message
        );

    }

    finally {

        hideLoadingMessage();

        input.value = "";

    }

}


// =========================================================
// LOADING MESSAGE
// =========================================================

function showLoadingMessage(
    message
) {

    let loader =
        document.getElementById(
            "globalLoader"
        );


    if (!loader) {

        loader =
            document.createElement(
                "div"
            );


        loader.id =
            "globalLoader";


        loader.style.position =
            "fixed";

        loader.style.top =
            "50%";

        loader.style.left =
            "50%";

        loader.style.transform =
            "translate(-50%, -50%)";

        loader.style.padding =
            "20px 30px";

        loader.style.background =
            "white";

        loader.style.borderRadius =
            "10px";

        loader.style.boxShadow =
            "0 5px 25px rgba(0,0,0,0.3)";

        loader.style.zIndex =
            "99999";

        loader.style.fontSize =
            "16px";


        document.body.appendChild(
            loader
        );

    }


    loader.innerHTML =
        "⏳ " + escapeHTML(
            message
        );

}


// =========================================================
// HIDE LOADING
// =========================================================

function hideLoadingMessage() {

    const loader =
        document.getElementById(
            "globalLoader"
        );


    if (loader) {
        loader.remove();
    }

}


// =========================================================
// LOAD SHAPEFILE BOUNDARIES
// =========================================================

async function loadMapBoundaries() {

    const division =
        document.getElementById(
            "division"
        )?.value || "";


    const district =
        document.getElementById(
            "district"
        )?.value || "";


    const tehsil =
        document.getElementById(
            "tehsil"
        )?.value || "";


    const na =
        document.getElementById(
            "na"
        )?.value || "";


    const pp =
        document.getElementById(
            "pp"
        )?.value || "";


    resetShapefileLayers();


    let type = "";


    if (pp) {

        type = "pp";

    }

    else if (na) {

        type = "na";

    }

    else if (tehsil) {

        type = "tehsil";

    }

    else if (district) {

        type = "district";

    }

    else if (division) {

        type = "division";

    }

    else {

        return;

    }


    const params =
        new URLSearchParams();


    params.set(
        "type",
        type
    );


    if (division) {

        params.set(
            "division",
            division
        );

    }


    if (district) {

        params.set(
            "district",
            district
        );

    }


    if (tehsil) {

        params.set(
            "tehsil",
            tehsil
        );

    }


    if (na) {

        params.set(
            "na",
            na
        );

    }


    if (pp) {

        params.set(
            "pp",
            pp
        );

    }


    try {

        const response =
            await fetch(
                "/map_boundaries?" +
                params.toString()
            );


        if (!response.ok) {

            throw new Error(
                "Map boundaries API error"
            );

        }


        const data =
            await response.json();


        if (!Array.isArray(data)) {
            return;
        }


        data.forEach(
            item => {

                if (!item.geometry) {
                    return;
                }


                const layer =
                    L.geoJSON(
                        {
                            type: "Feature",

                            geometry:
                                item.geometry,

                            properties: {

                                name:
                                    item.name,

                                division:
                                    item.division,

                                district:
                                    item.district,

                                tehsil:
                                    item.tehsil,

                                na:
                                    item.na,

                                pp:
                                    item.pp

                            }

                        },
                        {
                            weight: 2,
                            fillOpacity: 0.12
                        }
                    );


                layer.bindPopup(
                    `
                    <b>${escapeHTML(
                        item.type
                            ? item.type.toUpperCase()
                            : ""
                    )}</b><br>

                    <b>Name:</b>
                    ${escapeHTML(item.name)}<br>

                    <b>Division:</b>
                    ${escapeHTML(item.division)}<br>

                    <b>District:</b>
                    ${escapeHTML(item.district)}<br>

                    <b>Tehsil:</b>
                    ${escapeHTML(item.tehsil)}<br>

                    <b>NA:</b>
                    ${escapeHTML(item.na)}<br>

                    <b>PP:</b>
                    ${escapeHTML(item.pp)}
                    `
                );


                layer.addTo(map);


                shapefileLayers.push(
                    layer
                );

            }
        );


        if (
            shapefileLayers.length
        ) {

            const group =
                L.featureGroup(
                    shapefileLayers
                );


            const bounds =
                group.getBounds();


            if (
                bounds.isValid()
            ) {

                map.fitBounds(
                    bounds,
                    {
                        padding: [
                            20,
                            20
                        ]
                    }
                );

            }

        }

    }

    catch (error) {

        console.error(
            "Boundary loading error:",
            error
        );

    }

}


// =========================================================
// HTML ESCAPE
// =========================================================

function escapeHTML(value) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }


    return String(value)

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );

}
// =========================================================
// SPASIS SIDEBAR - DASHBOARD + PROGRESS
// =========================================================

(function () {

    function initSidebar() {

        const sidebar =
            document.getElementById("sidebar");

        const toggleButton =
            document.getElementById("sidebarToggle");


        if (!sidebar || !toggleButton) {

            console.error(
                "SPASIS Sidebar: elements not found"
            );

            return;
        }


        // Prevent duplicate event listeners
        if (
            toggleButton.dataset.sidebarReady === "true"
        ) {
            return;
        }


        toggleButton.dataset.sidebarReady = "true";


        // =====================================================
        // OPEN / CLOSE SIDEBAR
        // =====================================================

        toggleButton.addEventListener(
            "click",
            function (event) {

                event.preventDefault();
                event.stopPropagation();

                sidebar.classList.toggle("open");

                console.log(
                    "SPASIS Sidebar:",
                    sidebar.classList.contains("open")
                        ? "OPEN"
                        : "CLOSED"
                );

            }
        );


        // =====================================================
        // SIDEBAR LINK CLICK
        // =====================================================

        const navLinks =
            sidebar.querySelectorAll(".nav-item");


        navLinks.forEach(function (link) {

            link.addEventListener(
                "click",
                function () {

                    sidebar.classList.remove("open");

                }
            );

        });

    }


    // =========================================================
    // INITIALIZE ON EVERY PAGE LOAD
    // =========================================================

    if (
        document.readyState === "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            initSidebar
        );

    } else {

        initSidebar();

    }

})();


