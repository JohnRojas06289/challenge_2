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
    
    // Inicializar el medidor de temperatura
    const gauge = new JustGage({
        id: "gauge",
        value: 0,
        min: -10,
        max: 50,
        title: "°C",
        label: "Temperatura",
        pointer: true,
        pointerOptions: {
            toplength: -15,
            bottomlength: 10,
            bottomwidth: 12,
            color: '#8e8e93'
        },
        gaugeWidthScale: 0.7,
        counter: true,
        relativeGaugeSize: true
    });

    // Inicializar el medidor de humedad
    const gHumidity = new JustGage({
        id: "gauge-humidity",
        value: 60,  // Valor inicial
        min: 0,
        max: 100,
        title: "%",
        label: "Humedad",
        pointer: true,
        pointerOptions: {
            toplength: -15,
            bottomlength: 10,
            bottomwidth: 12,
            color: '#8e8e93'
        },
        gaugeWidthScale: 0.7,
        counter: true,
        relativeGaugeSize: true
    });
    
    // Historial para datos recientes
    let historialDatos = [];
    const maxHistorialRows = 5; // Máximo de filas en el dashboard
    
    // Función para conectar el WebSocket
    function conectarWebSocket() {
        // Determinar la URL del WebSocket
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        
        console.log(`Conectando a WebSocket: ${wsUrl}`);
        const socket = new WebSocket(wsUrl);
        
        // Evento de conexión establecida
        socket.onopen = function() {
            console.log('Conexión WebSocket establecida');
            mostrarNotificacion('Conexión establecida', 'success');
        };
        
        // Evento de mensaje recibido
        socket.onmessage = function(event) {
            const data = JSON.parse(event.data);
            console.log('Datos recibidos:', data);
            
            // Actualizar los elementos visuales con los datos recibidos
            document.getElementById("distance").innerText = data.distance.toFixed(1) + " cm";
            gauge.refresh(data.temperature);
            gHumidity.refresh(data.humidity);
            
            // Actualizar el estado según la distancia
            actualizarEstado(data.status);
            
            // Actualizar el indicador de nivel
            actualizarNivelIndicador(data.distance);
            
            // Actualizar el historial
            actualizarHistorial(data);
        };
        
        // Evento de error
        socket.onerror = function(error) {
            console.error('Error en la conexión WebSocket:', error);
            mostrarNotificacion('Error de conexión', 'error');
        };
        
        // Evento de conexión cerrada
        socket.onclose = function() {
            console.log('Conexión WebSocket cerrada. Intentando reconectar en 3 segundos...');
            mostrarNotificacion('Conexión perdida. Reconectando...', 'warning');
            setTimeout(conectarWebSocket, 3000);
        };
        
        return socket;
    }
    
    // Función para actualizar el estado visual según el estado recibido
    function actualizarEstado(estado) {
        const statusDiv = document.getElementById("status");
        statusDiv.innerText = estado;
        statusDiv.className = "status " + estado.toLowerCase();
    }
    
    // Función para actualizar el indicador visual de nivel
    function actualizarNivelIndicador(distancia) {
        const levelFill = document.getElementById("level-fill");
        // Calcular altura del relleno (invertido: menor distancia = mayor relleno)
        let heightPercentage = 0;
        
        if (distancia <= 10) {
            // Por debajo de 10cm, lleno al 100%
            heightPercentage = 100;
        } else if (distancia >= 40) {
            // Por encima de 40cm, vacío
            heightPercentage = 0;
        } else {
            // Entre 10 y 40cm, escalado
            heightPercentage = 100 - ((distancia - 10) / 30 * 100);
        }
        
        levelFill.style.height = heightPercentage + '%';
    }
    
    // Función para apagar dispositivos
    window.apagarDispositivos = function() {
        fetch('/apagar', { method: 'POST' })
            .then(response => response.text())
            .then(data => {
                mostrarNotificacion(data, 'success');
                console.log('Respuesta del servidor:', data);
            })
            .catch(error => {
                console.error('Error al enviar comando:', error);
                mostrarNotificacion('Error al apagar alarmas', 'error');
            });
    };
    
    // Función para actualizar el historial de reportes
    function actualizarHistorial(data) {
        // Agregar al inicio del array para mostrar lo más reciente primero
        const fecha = new Date().toLocaleString();
        
        historialDatos.unshift({
            fecha: fecha,
            distancia: data.distance.toFixed(1),
            temperatura: data.temperature.toFixed(1),
            estado: data.status
        });
        
        // Limitar el tamaño del historial
        if (historialDatos.length > maxHistorialRows) {
            historialDatos = historialDatos.slice(0, maxHistorialRows);
        }
        
        // Actualizar la tabla en el DOM
        const tabla = document.getElementById("historial").getElementsByTagName('tbody')[0];
        tabla.innerHTML = ''; // Limpiar tabla
        
        historialDatos.forEach(item => {
            const row = tabla.insertRow();
            row.className = item.estado.toLowerCase();
            
            const cellFecha = row.insertCell(0);
            const cellDistancia = row.insertCell(1);
            const cellTemperatura = row.insertCell(2);
            const cellEstado = row.insertCell(3);
            
            cellFecha.innerHTML = item.fecha;
            cellDistancia.innerHTML = `${item.distancia} cm`;
            cellTemperatura.innerHTML = `${item.temperatura} °C`;
            cellEstado.innerHTML = item.estado;
        });
        
        // Guardar en localStorage para persistencia
        localStorage.setItem('recientHistorial', JSON.stringify(historialDatos));
    }
    
    // Función para mostrar notificaciones
    function mostrarNotificacion(mensaje, tipo) {
        // Si existe una librería de notificaciones, usarla aquí
        console.log(`Notificación (${tipo}): ${mensaje}`);
        
        // Implementación básica (opcional)
        const notif = document.createElement('div');
        notif.className = `notificacion ${tipo}`;
        notif.textContent = mensaje;
        document.body.appendChild(notif);
        
        setTimeout(() => {
            notif.classList.add('mostrar');
            setTimeout(() => {
                notif.classList.remove('mostrar');
                setTimeout(() => {
                    document.body.removeChild(notif);
                }, 300);
            }, 3000);
        }, 10);
    }
    
    // Cargar historial desde localStorage si existe
    function cargarHistorialGuardado() {
        const historialGuardado = localStorage.getItem('recientHistorial');
        if (historialGuardado) {
            try {
                historialDatos = JSON.parse(historialGuardado);
                // Actualizar la tabla con los datos guardados
                const tabla = document.getElementById("historial").getElementsByTagName('tbody')[0];
                tabla.innerHTML = ''; // Limpiar tabla
                
                historialDatos.forEach(item => {
                    const row = tabla.insertRow();
                    row.className = item.estado.toLowerCase();
                    
                    const cellFecha = row.insertCell(0);
                    const cellDistancia = row.insertCell(1);
                    const cellTemperatura = row.insertCell(2);
                    const cellEstado = row.insertCell(3);
                    
                    cellFecha.innerHTML = item.fecha;
                    cellDistancia.innerHTML = `${item.distancia} cm`;
                    cellTemperatura.innerHTML = `${item.temperatura} °C`;
                    cellEstado.innerHTML = item.estado;
                });
            } catch (e) {
                console.error('Error al cargar historial:', e);
                // Si hay error, iniciar con array vacío
                historialDatos = [];
            }
        }
    }
    
    // Iniciar conexión WebSocket
    const socket = conectarWebSocket();
    
    // Cargar datos guardados
    cargarHistorialGuardado();
    
    // Si estamos en simulación, podemos simular datos
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        // Comprobar si está activo el servidor de simulación
        fetch('/api/current')
            .catch(() => {
                console.log('Modo simulación: generando datos aleatorios');
                
                // Crear simulación
                setInterval(() => {
                    // Generar datos aleatorios
                    const distancia = Math.random() * 30 + 5; // Entre 5 y 35 cm
                    const temperatura = 20 + Math.random() * 10; // Entre 20 y 30 °C
                    const humedad = 50 + Math.random() * 30; // Entre 50% y 80%
                    
                    // Determinar estado
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
                    
                    // Crear objeto de datos
                    const data = {
                        distance: distancia,
                        temperature: temperatura,
                        humidity: humedad,
                        status: estado
                    };
                    
                    // Actualizar interfaz
                    document.getElementById("distance").innerText = data.distance.toFixed(1) + " cm";
                    gauge.refresh(data.temperature);
                    gHumidity.refresh(data.humidity);
                    actualizarEstado(data.status);
                    actualizarNivelIndicador(data.distance);
                    actualizarHistorial(data);
                    
                }, 2000); // Actualizar cada 2 segundos
            });
    }
});