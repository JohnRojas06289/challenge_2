idf_component_register(SRCS "challenge_2.c"
                       INCLUDE_DIRS ".")
spiffs_create_partition_image(storage ../spiffs FLASH_IN_PROJECT)

