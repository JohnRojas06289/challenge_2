idf_component_register(SRCS "challenge_2.c"
                       INCLUDE_DIRS "."
                       REQUIRES mqtt spiffs esp_http_server esp_wifi nvs_flash esp_driver_gpio esp_adc)
spiffs_create_partition_image(storage ../spiffs FLASH_IN_PROJECT)