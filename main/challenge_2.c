// En lugar de usar estructuras especiales de WebSocket, usaremos las funciones básicas de HTTP
// para manejar la conexión WebSocket

#include "esp_spiffs.h"
#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include <dirent.h>
#include <string.h>
#include "driver/gpio.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_timer.h"
#include "esp_rom_sys.h"

// Definiciones de pines para sensores
#define TRIG_PIN               GPIO_NUM_4
#define ECHO_PIN               GPIO_NUM_2
#define LED_GREEN              GPIO_NUM_12
#define LED_YELLOW             GPIO_NUM_14
#define LED_RED                GPIO_NUM_27
#define BUZZER_PIN             GPIO_NUM_26
#define RAIN_SENSOR_DIGITAL    GPIO_NUM_32
#define RAIN_SENSOR_ANALOG     ADC_CHANNEL_6  // GPIO34
#define TEMP_SENSOR_ANALOG     ADC_CHANNEL_5  // GPIO33

// Umbrales de distancia (en cm)
#define THRESHOLD_CRITICAL     10  // Nivel crítico (activar alarma)
#define THRESHOLD_WARNING      20  // Nivel de advertencia
#define THRESHOLD_CAUTION      30  // Nivel de precaución

// Variables globales para los datos del sensor
typedef struct {
    float distance;        // Distancia en cm
    float temperature;     // Temperatura en °C
    float humidity;        // Humedad (del sensor de lluvia) en %
    char status[10];       // Estado: "NORMAL", "CAUTION", "WARNING", "CRITICAL"
    bool alarm_active;     // Estado de la alarma
} sensor_data_t;

static sensor_data_t current_data = {
    .distance = 40.0,
    .temperature = 25.0,
    .humidity = 50.0,
    .status = "NORMAL",
    .alarm_active = false
};

// Historial de datos para API
#define MAX_HISTORY_ENTRIES 100
static sensor_data_t history_data[MAX_HISTORY_ENTRIES];
static int history_count = 0;
static SemaphoreHandle_t history_mutex = NULL;

static const char *TAG = "challenge_2";
static EventGroupHandle_t wifi_event_group;
static httpd_handle_t server = NULL;
static const int CONNECTED_BIT = BIT0;

// Variables ADC
static adc_oneshot_unit_handle_t adc1_handle;

// Función para inicializar SPIFFS
void init_spiffs(void)
{
    esp_vfs_spiffs_conf_t conf = {
        .base_path = "/spiffs",
        .partition_label = NULL,
        .max_files = 5,
        .format_if_mount_failed = true
    };

    esp_err_t ret = esp_vfs_spiffs_register(&conf);

    if (ret != ESP_OK) {
        if (ret == ESP_FAIL) {
            ESP_LOGE(TAG, "Fallo al montar o formatear el sistema de archivos");
        } else if (ret == ESP_ERR_NOT_FOUND) {
            ESP_LOGE(TAG, "Partición SPIFFS no encontrada");
        } else {
            ESP_LOGE(TAG, "Fallo al inicializar SPIFFS (%s)", esp_err_to_name(ret));
        }
        return;
    }

    size_t total = 0, used = 0;
    ret = esp_spiffs_info(NULL, &total, &used);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Fallo al obtener información de SPIFFS (%s)", esp_err_to_name(ret));
    } else {
        ESP_LOGI(TAG, "Tamaño de la partición: total: %d, usado: %d", total, used);
    }
}

// Función para listar archivos en SPIFFS
void list_spiffs_files(void) {
    DIR* dir = opendir("/spiffs");
    if (dir == NULL) {
        ESP_LOGE(TAG, "Error al abrir directorio SPIFFS");
        return;
    }
    
    struct dirent* entry;
    while ((entry = readdir(dir)) != NULL) {
        ESP_LOGI(TAG, "Archivo encontrado: %s", entry->d_name);
    }
    
    closedir(dir);
}

// Función para agregar datos al historial
void add_to_history(sensor_data_t *data) {
    if (history_mutex == NULL) {
        return;
    }
    
    if (xSemaphoreTake(history_mutex, portMAX_DELAY) == pdTRUE) {
        // Desplazar todos los elementos para hacer espacio para el nuevo
        if (history_count == MAX_HISTORY_ENTRIES) {
            // Si está lleno, desplazar todos los elementos
            for (int i = MAX_HISTORY_ENTRIES - 1; i > 0; i--) {
                history_data[i] = history_data[i-1];
            }
        } else {
            // Si no está lleno, incrementar el contador
            history_count++;
        }
        
        // Añadir el nuevo elemento al inicio
        history_data[0] = *data;
        
        xSemaphoreGive(history_mutex);
    }
}

// Manejador para la API de datos actuales
static esp_err_t get_current_data_handler(httpd_req_t *req)
{
    char data_json[256];
    snprintf(data_json, sizeof(data_json), 
             "{\"distance\":%.1f,\"temperature\":%.1f,\"humidity\":%.1f,\"status\":\"%s\"}",
             current_data.distance, current_data.temperature, 
             current_data.humidity, current_data.status);
    
    httpd_resp_set_type(req, "application/json");
    // Añadir cabecera CORS para permitir peticiones desde cualquier origen
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_send(req, data_json, strlen(data_json));
    return ESP_OK;
}

// Manejador para la API de historial
static esp_err_t get_history_data_handler(httpd_req_t *req)
{
    // Buffer para acumular todos los datos JSON
    char *buffer = NULL;
    size_t buffer_size = 0;
    size_t entries = 0;
    
    // Obtener número de entradas solicitadas
    char param[32];
    if (httpd_req_get_url_query_str(req, param, sizeof(param)) == ESP_OK) {
        char count_str[8];
        if (httpd_query_key_value(param, "count", count_str, sizeof(count_str)) == ESP_OK) {
            int count = atoi(count_str);
            if (count > 0 && count < MAX_HISTORY_ENTRIES) {
                entries = count;
            }
        }
    }
    
    if (entries == 0) {
        entries = history_count; // Si no se especifica, enviar todo el historial
    }
    
    if (entries > history_count) {
        entries = history_count;
    }
    
    // Estimar el tamaño del buffer necesario
    buffer_size = entries * 256 + 50; // 256 bytes por entrada, más margen
    buffer = malloc(buffer_size);
    
    if (buffer == NULL) {
        ESP_LOGE(TAG, "Error al asignar memoria para historial");
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    
    // Iniciar el JSON como un array
    strcpy(buffer, "[\n");
    size_t offset = 2;
    
    if (xSemaphoreTake(history_mutex, portMAX_DELAY) == pdTRUE) {
        for (int i = 0; i < entries; i++) {
            // Añadir coma si no es el primer elemento
            if (i > 0) {
                buffer[offset++] = ',';
                buffer[offset++] = '\n';
            }
            
            // Formatear datos de la entrada
            offset += snprintf(buffer + offset, buffer_size - offset,
                        "  {\"timestamp\":%lld,\"distance\":%.1f,\"temperature\":%.1f,\"humidity\":%.1f,\"status\":\"%s\"}",
                        (long long)(esp_timer_get_time() / 1000) - i * 1000, // Timestamp simulado
                        history_data[i].distance,
                        history_data[i].temperature,
                        history_data[i].humidity,
                        history_data[i].status);
        }
        
        xSemaphoreGive(history_mutex);
    }
    
    // Cerrar el array JSON
    if (offset < buffer_size - 2) {
        buffer[offset++] = '\n';
        buffer[offset++] = ']';
        buffer[offset] = '\0';
    }
    
    httpd_resp_set_type(req, "application/json");
    // Añadir cabecera CORS para permitir peticiones desde cualquier origen
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_send(req, buffer, strlen(buffer));
    
    free(buffer);
    return ESP_OK;
}

// Manejador para apagar alarmas
static esp_err_t alarm_off_handler(httpd_req_t *req)
{
    current_data.alarm_active = false;
    
    // Apagar alarmas físicas
    gpio_set_level(BUZZER_PIN, 0);
    
    // Añadir cabecera CORS para permitir peticiones desde cualquier origen
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_sendstr(req, "Alarmas apagadas");
    return ESP_OK;
}

// Manejador para OPTIONS (preflight CORS)
static esp_err_t options_handler(httpd_req_t *req)
{
    httpd_resp_set_hdr(req, "Access-Control-Allow-Origin", "*");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    httpd_resp_set_hdr(req, "Access-Control-Allow-Headers", "Content-Type");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

// Manejador para favicon.ico
esp_err_t favicon_get_handler(httpd_req_t *req)
{
    // Simplemente enviar una respuesta 204 (No Content)
    httpd_resp_set_status(req, "204 No Content");
    httpd_resp_send(req, NULL, 0);
    return ESP_OK;
}

// Manejador para la raíz
esp_err_t index_get_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "Petición recibida para URI: %s", req->uri);
    const char* filepath = "/spiffs/index.html";
    FILE* file = fopen(filepath, "r");
    if (file == NULL) {
        ESP_LOGE(TAG, "Archivo no encontrado: %s", filepath);
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }

    fseek(file, 0, SEEK_END);
    size_t file_size = ftell(file);
    fseek(file, 0, SEEK_SET);

    char* buffer = malloc(file_size + 1);
    if (buffer == NULL) {
        ESP_LOGE(TAG, "Error al asignar memoria para buffer");
        fclose(file);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    
    size_t bytes_read = fread(buffer, 1, file_size, file);
    fclose(file);
    
    if (bytes_read != file_size) {
        ESP_LOGE(TAG, "Error al leer archivo: leídos %d de %d bytes", bytes_read, file_size);
        free(buffer);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    
    buffer[file_size] = '\0';

    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, buffer, file_size);
    free(buffer);
    return ESP_OK;
}

// Manejador para archivos estáticos
esp_err_t static_get_handler(httpd_req_t *req)
{
    ESP_LOGI(TAG, "Petición recibida para URI: %s", req->uri);
    
    // Verificar si la URI es demasiado larga
    if (strlen(req->uri) > 200) {
        ESP_LOGE(TAG, "URI demasiado larga: %d bytes", strlen(req->uri));
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }
    
    // Verificar caracteres no permitidos en la URI
    if (strstr(req->uri, "..") != NULL) {
        ESP_LOGE(TAG, "URI con secuencia no permitida '..'");
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }
    
    // Crear la ruta del archivo de manera segura
    char filepath[512]; // Buffer más grande para asegurar espacio suficiente
    int ret = snprintf(filepath, sizeof(filepath), "/spiffs%s", req->uri);
    
    // Verificar si hubo un error o truncamiento en snprintf
    if (ret < 0 || ret >= sizeof(filepath)) {
        ESP_LOGE(TAG, "Error al construir la ruta del archivo");
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }
    
    FILE* file = fopen(filepath, "r");
    if (file == NULL) {
        ESP_LOGE(TAG, "No se encontró el archivo: %s", filepath);
        httpd_resp_send_404(req);
        return ESP_FAIL;
    }

    // Establecer el tipo de contenido según la extensión
    if (strstr(req->uri, ".html")) {
        httpd_resp_set_type(req, "text/html");
    } else if (strstr(req->uri, ".css")) {
        httpd_resp_set_type(req, "text/css");
    } else if (strstr(req->uri, ".js")) {
        httpd_resp_set_type(req, "application/javascript");
    } else if (strstr(req->uri, ".png")) {
        httpd_resp_set_type(req, "image/png");
    } else if (strstr(req->uri, ".png")) {
        httpd_resp_set_type(req, "image/png");
    } else if (strstr(req->uri, ".jpg") || strstr(req->uri, ".jpeg")) {
        httpd_resp_set_type(req, "image/jpeg");
    }

    fseek(file, 0, SEEK_END);
    size_t file_size = ftell(file);
    fseek(file, 0, SEEK_SET);

    char* buffer = malloc(file_size + 1);
    if (buffer == NULL) {
        ESP_LOGE(TAG, "Error al asignar memoria para buffer");
        fclose(file);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    
    size_t bytes_read = fread(buffer, 1, file_size, file);
    fclose(file);
    
    if (bytes_read != file_size) {
        ESP_LOGE(TAG, "Error al leer archivo: leídos %d de %d bytes", bytes_read, file_size);
        free(buffer);
        httpd_resp_send_500(req);
        return ESP_FAIL;
    }
    
    buffer[file_size] = '\0';

    httpd_resp_send(req, buffer, file_size);
    free(buffer);
    return ESP_OK;
}

// Medir distancia con sensor ultrasónico
float measure_distance(void)
{
    // Enviar pulso de 10us al pin TRIG
    gpio_set_level(TRIG_PIN, 0);
    esp_rom_delay_us(2);
    gpio_set_level(TRIG_PIN, 1);
    esp_rom_delay_us(10);
    gpio_set_level(TRIG_PIN, 0);
    
    // Medir el ancho del pulso en el pin ECHO
    int64_t start = esp_timer_get_time();
    int64_t timeout = start + 30000;  // 30ms timeout
    
    // Esperar a que el pin ECHO se active (HIGH)
    while (gpio_get_level(ECHO_PIN) == 0 && esp_timer_get_time() < timeout) {
        esp_rom_delay_us(1);
    }
    
    int64_t echo_start = esp_timer_get_time();
    timeout = echo_start + 30000;  // 30ms timeout
    
    // Esperar a que el pin ECHO se desactive (LOW)
    while (gpio_get_level(ECHO_PIN) == 1 && esp_timer_get_time() < timeout) {
        esp_rom_delay_us(1);
    }
    
    int64_t echo_end = esp_timer_get_time();
    
    // Calcular duración del pulso y distancia
    double duration_us = echo_end - echo_start;
    float distance_cm = (duration_us / 2) * 0.0343;
    
    // Limitar rango
    if (distance_cm > 400) {
        distance_cm = 400;  // Máxima distancia del sensor
    } else if (distance_cm < 2) {
        distance_cm = 2;    // Mínima distancia del sensor
    }
    
    ESP_LOGD(TAG, "Pulso ultrasónico: duración=%lld µs, distancia=%.1f cm", 
             (long long)duration_us, distance_cm);
    
    return distance_cm;
}

// Leer temperatura desde el sensor TMP36GZ
float read_temperature(void)
{
    // Realizar múltiples lecturas para reducir ruido
    int raw_total = 0;
    const int num_samples = 5;
    
    for (int i = 0; i < num_samples; i++) {
        int raw_value = 0;
        if (adc_oneshot_read(adc1_handle, TEMP_SENSOR_ANALOG, &raw_value) == ESP_OK) {
            raw_total += raw_value;
        }
        vTaskDelay(pdMS_TO_TICKS(10)); // Pequeña pausa entre lecturas
    }
    
    int raw_value = raw_total / num_samples;
    
    // Convertir lectura ADC a voltaje (asumiendo 0-3.3V en rango 0-4095)
    float voltage = (float)raw_value * 3.3 / 4095.0;
    
    // TMP36GZ: 0.75V = 25°C, y cambia 10mV por cada °C
    float temperature = (voltage - 0.5) * 100.0;
    
    // Limitar rango de temperatura a valores razonables (evitar valores extremos por ruido)
    if (temperature < -10.0) temperature = 6.0;
    if (temperature > 26.0) temperature = 26.0;
    
    ESP_LOGI(TAG, "Lectura TMP36GZ: ADC=%d, Voltage=%.3fV, Temp=%.1f°C", 
             raw_value, voltage, temperature);
    
    return temperature;
}

// Leer sensor de lluvia (usar valor analógico para estimar humedad)
float read_humidity(void)
{
    int raw_value = 0;
    static int min_value = 4095;  // Valor más alto = seco
    static int max_value = 0;     // Valor más bajo = mojado
    
    // Leer valor del ADC
    esp_err_t err = adc_oneshot_read(adc1_handle, RAIN_SENSOR_ANALOG, &raw_value);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Error al leer sensor de lluvia: %s", esp_err_to_name(err));
        return 0.0;  // Valor por defecto
    }
    
    // Actualizar calibración automática
    if (raw_value < min_value) min_value = raw_value;
    if (raw_value > max_value) max_value = raw_value;
    
    // Evitar división por cero
    if (max_value == min_value) {
        return 0.0;
    }
    
    // Si el valor es cercano al máximo histórico, está seco (reiniciar a 0%)
    if (raw_value > (max_value - 100)) {
        return 0.0;
    }
    
    // Convertir a porcentaje usando rango dinámico
    float humidity = 100.0f * (float)(max_value - raw_value) / (float)(max_value - min_value);
    
    // Limitar entre 0% y 100%
    if (humidity < 0.0f) humidity = 0.0f;
    if (humidity > 100.0f) humidity = 100.0f;
    
    ESP_LOGI(TAG, "Lectura sensor lluvia: ADC=%d, min=%d, max=%d, Humedad=%.1f%%", 
             raw_value, min_value, max_value, humidity);
    
    return humidity;
}

// Actualizar estado del sistema según los datos de sensores
void update_system_status(void)
{
    // Determinar estado basado en la distancia
    if (current_data.distance <= THRESHOLD_CRITICAL) {
        strncpy(current_data.status, "CRITICAL", sizeof(current_data.status));
    } else if (current_data.distance <= THRESHOLD_WARNING) {
        strncpy(current_data.status, "WARNING", sizeof(current_data.status));
    } else if (current_data.distance <= THRESHOLD_CAUTION) {
        strncpy(current_data.status, "CAUTION", sizeof(current_data.status));
    } else {
        strncpy(current_data.status, "NORMAL", sizeof(current_data.status));
    }
    
    // Actualizar LEDs y alarma según el estado
    gpio_set_level(LED_GREEN, 0);
    gpio_set_level(LED_YELLOW, 0);
    gpio_set_level(LED_RED, 0);
    
    bool is_rain_detected = gpio_get_level(RAIN_SENSOR_DIGITAL) == 0;  // Lógica invertida
    
    if (is_rain_detected) {
        // Si hay lluvia, priorizar LED rojo sin buzzer
        gpio_set_level(LED_RED, 1);
        gpio_set_level(BUZZER_PIN, 0);
    } else {
        // Control basado en la distancia
        if (strcmp(current_data.status, "CRITICAL") == 0) {
            gpio_set_level(LED_RED, 1);
            if (current_data.alarm_active) {
                gpio_set_level(BUZZER_PIN, 1);
            }
        } else if (strcmp(current_data.status, "WARNING") == 0) {
            gpio_set_level(LED_YELLOW, 1);
            gpio_set_level(BUZZER_PIN, 0);
        } else {
            gpio_set_level(LED_GREEN, 1);
            gpio_set_level(BUZZER_PIN, 0);
        }
    }
}

// Inicializar GPIO para los sensores
void init_gpio(void)
{
    // Configurar pin para sensor ultrasónico
    gpio_config_t io_conf = {};
    io_conf.intr_type = GPIO_INTR_DISABLE;
    io_conf.mode = GPIO_MODE_OUTPUT;
    io_conf.pin_bit_mask = (1ULL << TRIG_PIN);
    io_conf.pull_down_en = 0;
    io_conf.pull_up_en = 0;
    gpio_config(&io_conf);
    
    io_conf.mode = GPIO_MODE_INPUT;
    io_conf.pin_bit_mask = (1ULL << ECHO_PIN);
    io_conf.pull_down_en = 0;
    io_conf.pull_up_en = 0;
    gpio_config(&io_conf);
    
    // Configurar pines para LEDs y buzzer
    io_conf.mode = GPIO_MODE_OUTPUT;
    io_conf.pin_bit_mask = (1ULL << LED_GREEN) | (1ULL << LED_YELLOW) | 
                          (1ULL << LED_RED) | (1ULL << BUZZER_PIN);
    gpio_config(&io_conf);
    
    // Configurar sensor de lluvia digital
    io_conf.mode = GPIO_MODE_INPUT;
    io_conf.pin_bit_mask = (1ULL << RAIN_SENSOR_DIGITAL);
    io_conf.pull_up_en = 1;  // Habilitar resistencia pull-up
    gpio_config(&io_conf);
    
    // Inicializar ADC para sensor de lluvia analógico y sensor de temperatura
    adc_oneshot_unit_init_cfg_t adc_config = {
        .unit_id = ADC_UNIT_1,
        .ulp_mode = ADC_ULP_MODE_DISABLE,
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&adc_config, &adc1_handle));
    
    // Configurar canal para sensor de lluvia
    adc_oneshot_chan_cfg_t rain_config = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, RAIN_SENSOR_ANALOG, &rain_config));
    
    // Configurar canal para sensor de temperatura
    adc_oneshot_chan_cfg_t temp_config = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc1_handle, TEMP_SENSOR_ANALOG, &temp_config));
    
    // Configurar estados iniciales
    gpio_set_level(LED_GREEN, 0);
    gpio_set_level(LED_YELLOW, 0);
    gpio_set_level(LED_RED, 0);
    gpio_set_level(BUZZER_PIN, 0);
    
    ESP_LOGI(TAG, "GPIO e inicialización de sensores completada");
}

// Tarea para leer sensores periódicamente
void sensor_task(void *pvParameters)
{
    // Reactivar alarma al inicio
    current_data.alarm_active = true;
    
    while (1) {
        // Leer sensores
        current_data.distance = measure_distance();
        current_data.temperature = read_temperature();
        current_data.humidity = read_humidity();
        
        // Actualizar estado del sistema
        update_system_status();
        
        // Log para depuración
        ESP_LOGI(TAG, "Distancia: %.1f cm, Temp: %.1f °C, Humedad: %.1f%%, Estado: %s", 
                 current_data.distance, current_data.temperature, 
                 current_data.humidity, current_data.status);
        
        // Guardar en historial
        add_to_history(&current_data);
        
        // Esperar antes de la siguiente lectura
        vTaskDelay(pdMS_TO_TICKS(1000));  // Leer cada segundo
    }
}

// Configuración de rutas URI
httpd_uri_t index_uri = {
    .uri       = "/",
    .method    = HTTP_GET,
    .handler   = index_get_handler,
    .user_ctx  = NULL
};

httpd_uri_t favicon_uri = {
    .uri       = "/favicon.ico",
    .method    = HTTP_GET,
    .handler   = favicon_get_handler,
    .user_ctx  = NULL
};

httpd_uri_t static_uri = {
    .uri       = "/*",
    .method    = HTTP_GET,
    .handler   = static_get_handler,
    .user_ctx  = NULL
};

httpd_uri_t api_current_uri = {
    .uri       = "/api/current",
    .method    = HTTP_GET,
    .handler   = get_current_data_handler,
    .user_ctx  = NULL
};

httpd_uri_t api_history_uri = {
    .uri       = "/api/history",
    .method    = HTTP_GET,
    .handler   = get_history_data_handler,
    .user_ctx  = NULL
};

httpd_uri_t apagar_uri = {
    .uri       = "/apagar",
    .method    = HTTP_POST,
    .handler   = alarm_off_handler,
    .user_ctx  = NULL
};

httpd_uri_t options_uri = {
    .uri       = "/*",
    .method    = HTTP_OPTIONS,
    .handler   = options_handler,
    .user_ctx  = NULL
};

// Iniciar servidor web
void start_webserver(void)
{
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    
    // Configurar para manejar cabeceras grandes
    config.max_resp_headers = 16;     // Aumentar número de cabeceras de respuesta
    config.max_uri_handlers = 15;     // Aumentar número de manejadores URI
    config.max_open_sockets = 7;      // Aumentar conexiones simultáneas
    config.recv_wait_timeout = 10;    // Aumentar tiempo de espera
    // Utilizar una función de coincidencia de comodín para facilitar el manejo de rutas
config.uri_match_fn = httpd_uri_match_wildcard;

    if (httpd_start(&server, &config) == ESP_OK) {
        // Primero registra el manejador específico para la raíz
        httpd_register_uri_handler(server, &index_uri);
        // Registrar manejador para favicon.ico
        httpd_register_uri_handler(server, &favicon_uri);
        // Registrar manejador API para datos actuales
        httpd_register_uri_handler(server, &api_current_uri);
        // Registrar manejador API para historial
        httpd_register_uri_handler(server, &api_history_uri);
        // Registrar manejador para apagar alarmas
        httpd_register_uri_handler(server, &apagar_uri);
        // Registrar manejador para peticiones OPTIONS (CORS)
        httpd_register_uri_handler(server, &options_uri);
        // Luego registra el manejador para los recursos estáticos
        httpd_register_uri_handler(server, &static_uri);
        
        ESP_LOGI(TAG, "Servidor web iniciado correctamente");
    } else {
        ESP_LOGE(TAG, "Error al iniciar el servidor web");
    }
}

// Manejador de eventos WiFi
static void event_handler(void* arg, esp_event_base_t event_base,
                          int32_t event_id, void* event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGI(TAG, "Conexión Wi-Fi perdida, reconectando...");
        esp_wifi_connect();
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t* event = (ip_event_got_ip_t*) event_data;
        ESP_LOGI(TAG, "Conectado con dirección IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(wifi_event_group, CONNECTED_BIT);
    }
}

// Inicializar WiFi
void wifi_init_sta(void)
{
    wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT,
                                                        ESP_EVENT_ANY_ID,
                                                        &event_handler,
                                                        NULL,
                                                        &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT,
                                                        IP_EVENT_STA_GOT_IP,
                                                        &event_handler,
                                                        NULL,
                                                        &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = "Realme",
            .password = "123456789",
            .threshold.authmode = WIFI_AUTH_WPA2_PSK
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(ESP_IF_WIFI_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "Conectando a %s...", wifi_config.sta.ssid);

    EventBits_t bits = xEventGroupWaitBits(wifi_event_group,
            CONNECTED_BIT,
            pdFALSE,
            pdTRUE,
            portMAX_DELAY);

    if (bits & CONNECTED_BIT) {
        ESP_LOGI(TAG, "Conexión establecida");
    } else {
        ESP_LOGE(TAG, "No se pudo conectar al Wi-Fi");
    }
}

void app_main(void)
{
    // Inicializar subsistemas
    init_spiffs();
    list_spiffs_files(); // Lista los archivos para depuración
    
    // Crear mutex para historial
    history_mutex = xSemaphoreCreateMutex();
    if (history_mutex == NULL) {
        ESP_LOGE(TAG, "Error al crear mutex para historial");
    }
    
    // Inicializar GPIO para sensores (incluye ADC para temperatura y lluvia)
    init_gpio();
    
    // Inicializar WiFi
    wifi_init_sta();
    
    // Iniciar servidor web
    start_webserver();
    
    // Crear tarea para lecturas de sensores
    xTaskCreate(sensor_task, "sensor_task", 4096, NULL, tskIDLE_PRIORITY + 2, NULL);
    
    ESP_LOGI(TAG, "Sistema inicializado correctamente");
}