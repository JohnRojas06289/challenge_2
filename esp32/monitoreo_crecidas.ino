#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// Configuración de la LCD
LiquidCrystal_I2C lcd(0x27, 16, 2);  // Dirección I2C puede necesitar ajuste

// Definición de pines (ajustar según tu configuración en Arduino)
#define BUFFER_SIZE 5
#define BUZZER_PIN 8
#define LED_NORMAL_PIN 9    // Verde
#define LED_WARNING_PIN 10  // Amarillo
#define LED_CRITICAL_PIN 11 // Rojo

// Pines del sensor ultrasónico
#define TRIGGER_PIN 6
#define ECHO_PIN 7

// Pin del sensor de temperatura TMP36
#define TEMP_SENSOR_PIN A0  

// Umbrales de distancia (cm)
#define THRESHOLD_CRITICAL 10  
#define THRESHOLD_WARNING  20  
#define THRESHOLD_CAUTION  30  

// Enumeración de estados
enum State {
  NORMAL,
  CAUTION,
  WARNING,
  CRITICAL
};

// Variables del sistema
State currentState = NORMAL;
int sensorBuffer[BUFFER_SIZE];
int bufferIndex = 0;
bool bufferFilled = false;
float currentDistance = 0;
float currentTemperature = 0;

// Control del buzzer
unsigned long lastBuzzerToggle = 0;
unsigned long buzzerInterval = 0;
bool buzzerOn = false;
int buzzerIntensity = 0;

// Función para leer la distancia desde el sensor ultrasónico
float leerDistancia() {
  digitalWrite(TRIGGER_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIGGER_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIGGER_PIN, LOW);
  
  long duration = pulseIn(ECHO_PIN, HIGH);
  float distance = duration * 0.0343 / 2;
  
  // Filtrar lecturas inválidas
  if (distance <= 0 || distance > 400) return 400;
  return distance;
}

// Función para calcular el promedio de lecturas
float calcularPromedio() {
  int sum = 0;
  int count = bufferFilled ? BUFFER_SIZE : bufferIndex;
  if (count == 0) return 400;  // Valor por defecto si no hay lecturas
  for (int i = 0; i < count; i++) {
    sum += sensorBuffer[i];
  }
  return (float)sum / count;
}

// Función para leer temperatura del TMP36
float leerTemperatura() {
  int valorAnalogico = analogRead(TEMP_SENSOR_PIN);
  float voltaje = valorAnalogico * (5.0 / 1023.0); // Arduino tiene ADC de 10 bits (0-1023)
  float temperatura = (voltaje - 0.5) * 100.0;     // Fórmula para TMP36
  return temperatura;
}

// Función para actualizar las salidas (LEDs y LCD)
void actualizarSalidas() {
  // Apagar todos los LEDs
  digitalWrite(LED_NORMAL_PIN, LOW);
  digitalWrite(LED_WARNING_PIN, LOW);
  digitalWrite(LED_CRITICAL_PIN, LOW);

  // Configurar salidas según el estado
  switch(currentState) {
    case CRITICAL:
      digitalWrite(LED_CRITICAL_PIN, HIGH);
      buzzerInterval = 200;
      buzzerIntensity = 255;
      break;
      
    case WARNING:
      digitalWrite(LED_WARNING_PIN, HIGH);
      buzzerInterval = 500;
      buzzerIntensity = 128;
      break;
      
    case CAUTION:
      digitalWrite(LED_WARNING_PIN, HIGH);
      digitalWrite(LED_NORMAL_PIN, HIGH);
      buzzerInterval = 1000;
      buzzerIntensity = 64;
      break;
      
    default:
      digitalWrite(LED_NORMAL_PIN, HIGH);
      buzzerInterval = 0;
      buzzerIntensity = 0;
      break;
  }
}

// Función para controlar el buzzer
void controlarBuzzer() {
  if (currentState == NORMAL || buzzerInterval == 0) {
    analogWrite(BUZZER_PIN, 0);
    return;
  }
  
  if (millis() - lastBuzzerToggle >= buzzerInterval) {
    lastBuzzerToggle = millis();
    buzzerOn = !buzzerOn;
    analogWrite(BUZZER_PIN, buzzerOn ? buzzerIntensity : 0);
  }
}

// Función para obtener el estado como texto
String getStateText(State state) {
  switch(state) {
    case NORMAL: return "NORMAL";
    case CAUTION: return "CAUTION";
    case WARNING: return "WARNING";
    case CRITICAL: return "CRITICAL";
    default: return "UNKNOWN";
  }
}

void setup() {
  Serial.begin(9600);
  
  // Inicializar pantalla LCD
  Wire.begin();
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Iniciando...");
  lcd.setCursor(0, 1);
  lcd.print("Arduino IoT");
  delay(2000);
  lcd.clear();

  // Configurar pines
  pinMode(TRIGGER_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_NORMAL_PIN, OUTPUT);
  pinMode(LED_WARNING_PIN, OUTPUT);
  pinMode(LED_CRITICAL_PIN, OUTPUT);
  
  // Inicializar buffer
  for (int i = 0; i < BUFFER_SIZE; i++) {
    sensorBuffer[i] = 0;
  }
  
  Serial.println("Sistema de monitoreo iniciado");
}

void loop() {
  // Leer sensores
  float distance = leerDistancia();
  sensorBuffer[bufferIndex] = distance;
  bufferIndex = (bufferIndex + 1) % BUFFER_SIZE;
  if (bufferIndex == 0) bufferFilled = true;
  
  currentDistance = calcularPromedio();
  currentTemperature = leerTemperatura();
  
  // Determinar estado basado en la distancia
  if (currentDistance <= THRESHOLD_CRITICAL) {
    currentState = CRITICAL;
  } else if (currentDistance <= THRESHOLD_WARNING) {
    currentState = WARNING;
  } else if (currentDistance <= THRESHOLD_CAUTION) {
    currentState = CAUTION;
  } else {
    currentState = NORMAL;
  }
  
  // Actualizar salidas físicas
  actualizarSalidas();
  controlarBuzzer();
  
  // Mostrar en la LCD
  lcd.setCursor(0, 0);
  lcd.print("Dist: ");
  lcd.print(currentDistance);
  lcd.print(" cm  ");

  lcd.setCursor(0, 1);
  lcd.print("Est: ");
  switch (currentState) {
    case NORMAL:   lcd.print("NORM"); break;
    case CAUTION:  lcd.print("CAUTI"); break;
    case WARNING:  lcd.print("WARN"); break;
    case CRITICAL: lcd.print("CRIT"); break;
  }

  // Mostrar temperatura
  lcd.setCursor(9, 1);
  lcd.print(currentTemperature);
  lcd.print("C ");
  
  // Imprimir en Serial para debug
  Serial.print("Distancia: ");
  Serial.print(currentDistance);
  Serial.print("cm | Estado: ");
  Serial.print(getStateText(currentState));
  Serial.print(" | Temp: ");
  Serial.print(currentTemperature);
  Serial.println("C");
  
  // Esperar antes de la siguiente lectura
  delay(500);
}