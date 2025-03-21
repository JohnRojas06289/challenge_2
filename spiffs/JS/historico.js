document.addEventListener("DOMContentLoaded", function() {
    // Inicializar el toggle del sidebar
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const body = document.body;
    
    sidebarToggle.addEventListener('click', function() {
        if (window.innerWidth > 992) {
            body.classList.toggle('sidebar-collapsed');
        } else {
            body.classList.toggle('sidebar-expanded');
        }
    });
    
    // Estado global de la página
    const state = {
        data: [],
        filteredData: [],
        currentPage: 1,
        itemsPerPage: 20,
        totalPages: 1,
        sortColumn: 'timestamp',
        sortDirection: 'desc',
        filters: {
            dateRange: null,
            estado: 'all'
        }
    };
    
    // Inicializar Flatpickr para selector de fechas
    const dateRangePicker = flatpickr("#date-range", {
        mode: "range",
        dateFormat: "Y-m-d",
        locale: {
            firstDayOfWeek: 1,
            weekdays: {
                shorthand: ["Do", "Lu", "Ma", "Mi", "Ju", "Vi", "Sa"],
                longhand: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"]
            },
            months: {
                shorthand: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
                longhand: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
            }
        },
        onChange: function(selectedDates, dateStr) {
            if (selectedDates.length === 2) {
                state.filters.dateRange = {
                    from: selectedDates[0],
                    to: selectedDates[1]
                };
            } else {
                state.filters.dateRange = null;
            }
        }
    });
    
    // Inicializar filtros
    document.getElementById("estado-filter").addEventListener("change", function() {
        state.filters.estado = this.value;
    });
    
    document.getElementById("entries-count").addEventListener("change", function() {
        state.itemsPerPage = parseInt(this.value);
        state.currentPage = 1;
        filtrarYMostrarDatos();
    });
    
    // Botón de aplicar filtros
    document.getElementById("apply-filters").addEventListener("click", function() {
        state.currentPage = 1;
        filtrarYMostrarDatos();
    });
    
    // Botón de exportar a CSV
    document.getElementById("export-csv").addEventListener("click", exportarCSV);
    
    // Paginación
    document.getElementById("prev-page").addEventListener("click", function() {
        if (state.currentPage > 1) {
            state.currentPage--;
            mostrarDatos();
            actualizarControlPaginacion();
        }
    });
    
    document.getElementById("next-page").addEventListener("click", function() {
        if (state.currentPage < state.totalPages) {
            state.currentPage++;
            mostrarDatos();
            actualizarControlPaginacion();
        }
    });
    
    // Agregar listeners para ordenamiento
    document.querySelectorAll("th").forEach(th => {
        th.addEventListener("click", function() {
            const column = obtenerColumnaDeHeader(this.textContent.trim());
            if (column) {
                if (state.sortColumn === column) {
                    // Cambiar dirección de ordenamiento si ya está ordenado por esta columna
                    state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    // Nueva columna, establecer como ordenamiento descendente por defecto
                    state.sortColumn = column;
                    state.sortDirection = 'desc';
                }
                ordenarDatos();
                mostrarDatos();
                actualizarIndicadoresOrden();
            }
        });
    });
    
    // Función para obtener nombre de columna desde texto del encabezado
    function obtenerColumnaDeHeader(headerText) {
        const mapeo = {
            'Fecha y Hora': 'timestamp',
            'Distancia (cm)': 'distance',
            'Temperatura (°C)': 'temperature',
            'Humedad (%)': 'humidity',
            'Estado': 'status'
        };
        
        for (const [header, column] of Object.entries(mapeo)) {
            if (headerText.includes(header)) {
                return column;
            }
        }
        
        return null;
    }
    
    // Actualizar indicadores de ordenamiento
    function actualizarIndicadoresOrden() {
        document.querySelectorAll("th i").forEach(icon => {
            icon.className = "fas fa-sort";
        });
        
        const columnas = {
            'timestamp': 0,
            'distance': 1,
            'temperature': 2,
            'humidity': 3,
            'status': 4
        };
        
        if (state.sortColumn in columnas) {
            const headerIndex = columnas[state.sortColumn];
            const th = document.querySelectorAll("th")[headerIndex];
            const icon = th.querySelector("i");
            
            icon.className = `fas fa-sort-${state.sortDirection === 'asc' ? 'up' : 'down'}`;
            icon.style.opacity = '1';
        }
    }
    
    // Cargar datos
    function cargarDatos() {
        // Mostrar indicador de carga
        const tbody = document.querySelector("#historial-completo tbody");
        tbody.innerHTML = '<tr><td colspan="5" class="loading-message">Cargando datos...</td></tr>';
        
        fetch('/api/history')
            .then(response => response.json())
            .then(data => {
                // Convertir timestamps a objetos Date para ordenamiento y filtrado
                state.data = data.map(item => ({
                    ...item,
                    date: new Date(item.timestamp)
                }));
                
                ordenarDatos();
                filtrarYMostrarDatos();
                actualizarEstadisticas();
                actualizarIndicadoresOrden();
            })
            .catch(error => {
                console.error('Error al cargar datos históricos:', error);
                tbody.innerHTML = '<tr><td colspan="5" class="loading-message error">Error al cargar datos. Intente de nuevo.</td></tr>';
                
                // Si estamos en modo local/simulación, generar datos aleatorios
                if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                    console.log('Generando datos históricos simulados');
                    state.data = generarDatosSimulados();
                    ordenarDatos();
                    filtrarYMostrarDatos();
                    actualizarEstadisticas();
                    actualizarIndicadoresOrden();
                }
            });
    }
    
    // Generar datos simulados para pruebas
    function generarDatosSimulados() {
        const datos = [];
        const ahora = new Date();
        
        for (let i = 0; i < 100; i++) {
            const timestamp = new Date(ahora.getTime() - i * 300000); // Registro cada 5 minutos
            const distancia = Math.random() * 40 + 5; // Entre 5 y 45 cm
            const temperatura = 18 + Math.random() * 14; // Entre 18 y 32 °C
            const humedad = 45 + Math.random() * 40; // Entre 45% y 85%
            
            let estado;
            if (distancia <= 10) {
                estado = "CRITICAL";
            } else if (distancia <= 20) {
                estado = "WARNING";
            } else if (distancia <= 30) {
                estado = "CAUTION";
            } else {
                estado = "NORMAL";
            }
            
            datos.push({
                timestamp: timestamp.getTime(),
                date: timestamp,
                distance: parseFloat(distancia.toFixed(1)),
                temperature: parseFloat(temperatura.toFixed(1)),
                humidity: parseFloat(humedad.toFixed(1)),
                status: estado
            });
        }
        
        return datos;
    }
    
    // Filtrar datos según criterios
    function filtrarDatos() {
        state.filteredData = state.data.filter(item => {
            // Filtrar por estado
            if (state.filters.estado !== 'all' && item.status !== state.filters.estado) {
                return false;
            }
            
            // Filtrar por rango de fechas
            if (state.filters.dateRange) {
                const itemDate = new Date(item.date);
                const fromDate = new Date(state.filters.dateRange.from);
                const toDate = new Date(state.filters.dateRange.to);
                
                // Ajustar toDate para incluir todo el día
                toDate.setHours(23, 59, 59, 999);
                
                if (itemDate < fromDate || itemDate > toDate) {
                    return false;
                }
            }
            
            return true;
        });
        
        // Calcular total de páginas
        state.totalPages = Math.ceil(state.filteredData.length / state.itemsPerPage);
        if (state.totalPages === 0) state.totalPages = 1;
        
        // Ajustar página actual si es necesario
        if (state.currentPage > state.totalPages) {
            state.currentPage = state.totalPages;
        }
    }
    
    // Ordenar datos
    function ordenarDatos() {
        state.data.sort((a, b) => {
            let valA, valB;
            
            switch (state.sortColumn) {
                case 'timestamp':
                    valA = a.date.getTime();
                    valB = b.date.getTime();
                    break;
                case 'distance':
                case 'temperature':
                case 'humidity':
                    valA = a[state.sortColumn];
                    valB = b[state.sortColumn];
                    break;
                case 'status':
                    // Orden personalizado: CRITICAL > WARNING > CAUTION > NORMAL
                    const orden = { 'CRITICAL': 4, 'WARNING': 3, 'CAUTION': 2, 'NORMAL': 1 };
                    valA = orden[a.status] || 0;
                    valB = orden[b.status] || 0;
                    break;
                default:
                    valA = a.date.getTime();
                    valB = b.date.getTime();
            }
            
            if (state.sortDirection === 'asc') {
                return valA - valB;
            } else {
                return valB - valA;
            }
        });
    }
    
    // Filtrar y mostrar datos
    function filtrarYMostrarDatos() {
        filtrarDatos();
        mostrarDatos();
        actualizarControlPaginacion();
        actualizarEstadisticas();
    }
    
    // Mostrar datos en la tabla
    function mostrarDatos() {
        const tbody = document.querySelector("#historial-completo tbody");
        tbody.innerHTML = '';
        
        if (state.filteredData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="loading-message">No hay datos que coincidan con los filtros.</td></tr>';
            return;
        }
        
        // Calcular índices de inicio y fin para la página actual
        const inicio = (state.currentPage - 1) * state.itemsPerPage;
        const fin = Math.min(inicio + state.itemsPerPage, state.filteredData.length);
        
        // Mostrar datos para la página actual
        for (let i = inicio; i < fin; i++) {
            const item = state.filteredData[i];
            const row = document.createElement('tr');
            row.className = item.status.toLowerCase();
            
            // Crear celdas
            const fecha = new Date(item.date).toLocaleString();
            row.innerHTML = `
                <td>${fecha}</td>
                <td>${item.distance.toFixed(1)} cm</td>
                <td>${item.temperature.toFixed(1)} °C</td>
                <td>${item.humidity.toFixed(1)} %</td>
                <td>${item.status}</td>
            `;
            
            tbody.appendChild(row);
        }
    }
    
    // Actualizar información y controles de paginación
    function actualizarControlPaginacion() {
        document.getElementById("page-info").textContent = `Página ${state.currentPage} de ${state.totalPages}`;
        
        const prevBtn = document.getElementById("prev-page");
        const nextBtn = document.getElementById("next-page");
        
        prevBtn.disabled = state.currentPage <= 1;
        nextBtn.disabled = state.currentPage >= state.totalPages;
    }
    
    // Actualizar estadísticas
    function actualizarEstadisticas() {
        // Si no hay datos filtrados, no mostrar estadísticas
        if (state.filteredData.length === 0) {
            document.getElementById("avg-distance").textContent = "No hay datos";
            document.getElementById("max-temp").textContent = "No hay datos";
            document.getElementById("min-temp").textContent = "No hay datos";
            document.getElementById("critical-count").textContent = "0";
            return;
        }
        
        // Calcular promedio de distancia
        const totalDistancia = state.filteredData.reduce((sum, item) => sum + item.distance, 0);
        const avgDistancia = totalDistancia / state.filteredData.length;
        document.getElementById("avg-distance").textContent = `${avgDistancia.toFixed(1)} cm`;
        
        // Encontrar temperatura máxima y mínima
        const temperaturas = state.filteredData.map(item => item.temperature);
        const maxTemp = Math.max(...temperaturas);
        const minTemp = Math.min(...temperaturas);
        document.getElementById("max-temp").textContent = `${maxTemp.toFixed(1)} °C`;
        document.getElementById("min-temp").textContent = `${minTemp.toFixed(1)} °C`;
        
        // Contar alertas críticas
        const criticalCount = state.filteredData.filter(item => item.status === 'CRITICAL').length;
        document.getElementById("critical-count").textContent = criticalCount;
    }
    
    // Exportar datos a CSV
    function exportarCSV() {
        if (state.filteredData.length === 0) {
            alert('No hay datos para exportar');
            return;
        }
        
        let csvContent = "data:text/csv;charset=utf-8,";
        
        // Encabezados
        csvContent += "Fecha y Hora,Distancia (cm),Temperatura (°C),Humedad (%),Estado\n";
        
        // Datos
        state.filteredData.forEach(item => {
            const fecha = new Date(item.date).toLocaleString();
            const row = [
                `"${fecha}"`,
                item.distance.toFixed(1),
                item.temperature.toFixed(1),
                item.humidity.toFixed(1),
                item.status
            ].join(",");
            csvContent += row + "\n";
        });
        
        // Crear enlace de descarga
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `historico_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        
        // Descargar archivo
        link.click();
        
        // Limpiar
        document.body.removeChild(link);
    }
    
    // Cargar datos al iniciar
    cargarDatos();
});