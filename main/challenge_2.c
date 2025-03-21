#include "esp_spiffs.h"
#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include <dirent.h>

static const char *TAG = "challenge_2";
static EventGroupHandle_t wifi_event_group;
const int CONNECTED_BIT = BIT0;

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

httpd_uri_t index_uri = {
    .uri       = "/",
    .method    = HTTP_GET,
    .handler   = index_get_handler,
    .user_ctx  = NULL
};

httpd_uri_t static_uri = {
    .uri       = "/*",
    .method    = HTTP_GET,
    .handler   = static_get_handler,
    .user_ctx  = NULL
};

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
    
    httpd_handle_t server = NULL;

    if (httpd_start(&server, &config) == ESP_OK) {
        // Primero registra el manejador específico para la raíz
        httpd_register_uri_handler(server, &index_uri);
        // Luego registra el manejador para los recursos estáticos
        httpd_register_uri_handler(server, &static_uri);
        ESP_LOGI(TAG, "Servidor web iniciado correctamente");
    } else {
        ESP_LOGE(TAG, "Error al iniciar el servidor web");
    }
}

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
    init_spiffs();
    list_spiffs_files(); // Lista los archivos para depuración
    wifi_init_sta();
    start_webserver();
}
