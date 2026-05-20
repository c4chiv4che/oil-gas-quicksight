# Resumen del Proyecto — Para Lectores No Técnicos

Este documento explica, en lenguaje claro, qué es este proyecto, qué simula y por qué tiene valor. No hace falta saber de petróleo y gas ni de software.

---

## En una frase

Este proyecto recrea los datos que generaría una operación real de gas no convencional en Vaca Muerta —miles de mediciones de sensores por minuto— y los lleva a la nube para analizarlos y visualizarlos, igual que como una empresa energética real monitorea sus plantas.

---

## El problema real que representa

Una planta de procesamiento de gas es una red de pozos, cañerías, compresores y sistemas de seguridad. Cada uno tiene sensores: presión, temperatura, caudal, vibración, composición del gas. Una planta mediana genera **miles de mediciones por minuto, las 24 horas.**

Alguien tiene que vigilar esa catarata de datos y responder preguntas como: ¿Está sano cada pozo? ¿El gas que vendemos cumple los límites legales de calidad? ¿Hubo una parada de emergencia, y cómo respondió la planta? ¿Estamos perdiendo producción en algún lado?

Hacerlo bien ahorra plata, previene accidentes y mantiene el gas vendible. Hacerlo mal significa pérdida de ingresos, multas regulatorias o condiciones inseguras.

Este proyecto construye la cadena completa —del "sensor" al "tablero"— para una operación simulada realista.

---

## Qué hace el simulador

Como no tenemos una planta real conectada, el proyecto incluye un **simulador**: un programa que genera datos exactamente como lo haría una instalación real, siguiendo la física y las normas de la industria argentina. Produce alrededor de **1,5 millones de mediciones** que cubren 6 meses de operación de un pad de 4 pozos y su planta de procesamiento.

Los datos son lo suficientemente realistas como para que aparezcan los patrones que un operador de sala de control reconocería: pozos declinando con el tiempo, una parada de emergencia de planta, gas que se sale de especificación de calidad, vibración de equipos que va creciendo.

---

## Las tres capas

La operación se modela en tres capas conectadas, igual que en la realidad:

**1. Los Pozos (upstream)** — Cuatro pozos no convencionales que extraen petróleo, gas y agua del subsuelo. Cada uno se comporta como un pozo real: mucha producción al principio, después una declinación natural lenta; problemas ocasionales como el "bloqueo por gas" (gas lock, una bolsa de aire en la bomba) o arena que tapa el flujo.

**2. La Planta (midstream)** — Donde la mezcla cruda de los pozos se limpia y se separa en productos vendibles. Se quita el agua, se seca y se enfría el gas, se eliminan impurezas y se mide para la venta. Es la capa más compleja.

**3. Los Servicios Auxiliares (utilities)** — Los sistemas que mantienen la planta funcionando: aceite caliente para calefacción, aire comprimido para los instrumentos, y la antorcha (la llama grande que quema de forma segura el exceso de gas en emergencias).

---

## Las variables, explicadas por capa

Cada "variable" es la lectura de un sensor. Esto es lo que el proyecto monitorea y por qué importa cada grupo.

### Pozos — producción y salud

- **Caudales de petróleo / gas / agua** — Cuánto produce el pozo de cada uno. La medida central de si un pozo genera dinero.
- **Presión de boca de pozo y de fondo** — Con qué fuerza empuja el pozo. La caída de presión indica un pozo que madura.
- **Relación gas-petróleo y corte de agua** — La mezcla de lo que sube. Demasiada agua o gas cambia la economía del pozo.
- **Corriente, frecuencia y vibración de la bomba** — Los signos vitales de la bomba eléctrica. La vibración creciente avisa de una falla antes de que ocurra.
- **Composición del gas (metano, etano, CO2, etc.)** — De qué está hecho realmente el gas, medido continuamente.
- **Detección de arena y riesgo de corrosión** — Alertas tempranas para las dos cosas que destruyen los equipos.

*Por qué importa: acá nace el ingreso y empiezan las fallas caras. Detectar una bomba enferma a tiempo puede ahorrar una reparación de seis cifras.*

### Planta — convertir lo crudo en producto vendible

- **Presiones, temperaturas y niveles de separadores** — La primera separación de petróleo, gas y agua. Los niveles deben mantenerse en rango o el producto se arrastra.
- **Deshidratación con TEG** — Quitar el agua del gas (el gas húmedo corroe los gasoductos y forma bloqueos tipo hielo).
- **Refrigeración / punto de rocío** — Enfriar el gas para extraer componentes pesados y que cumpla la especificación del gasoducto.
- **Compresión (presión de succión/descarga, vibración, anti-surge)** — Elevar la presión del gas para el gasoducto de venta. Los compresores son las máquinas más caras y más protegidas de la planta.
- **Medición fiscal y calidad (PCS, Índice de Wobbe, densidad, H2S, CO2, contenido de agua)** — Las propiedades del gas que se vende, medidas legalmente. Deben cumplir la norma nacional **NAG-602** o el gas no puede entrar al gasoducto.

*Por qué importa: es la diferencia entre producto vendible y producto rechazado. El Índice de Wobbe por sí solo determina si tu gas es "demasiado rico" para venderse.*

### Servicios auxiliares — mantener todo vivo

- **Sistema de aceite caliente** — Provee calor a toda la planta. Cuando cae, los procesos se frenan.
- **Aire de instrumentos** — Acciona las válvulas neumáticas. Si se pierde, la planta falla de forma segura (se para).
- **Antorcha (alta/baja presión, piloto, humo)** — El alivio de seguridad. Durante una parada de emergencia, la antorcha puede dispararse para quemar todo el inventario de gas de la planta en minutos.

*Por qué importa: los servicios auxiliares son invisibles hasta que fallan, y cuando fallan, todo se detiene.*

### El ESD — Parada de Emergencia

Un conjunto especial de mediciones rastrea las **paradas de emergencia** (ESD, por Emergency Shutdown): la secuencia automática de seguridad que se dispara cuando se detecta algo peligroso (fuego, fuga de gas, sobrepresión). El simulador modela la secuencia completa de 8 pasos —se cierran los pozos, la planta despresuriza hacia la antorcha, los compresores se detienen, los servicios caen, y luego una recuperación controlada—. Es el evento más crítico para la seguridad en cualquier planta.

---

## Por qué tiene valor

**Para una empresa energética:** demuestra un esquema funcional para convertir datos crudos de sensores en información operativa —monitorear producción, asegurar el cumplimiento de calidad del gas, y analizar eventos de seguridad— construido enteramente sobre herramientas de nube estándar y de bajo costo.

**Para el perfil del autor:** une dos mundos que rara vez coinciden en una misma persona —el conocimiento práctico de tecnología operacional (OT) de cómo se comporta una planta real, y las habilidades modernas de ingeniería de datos en la nube (infraestructura como código, pipelines automatizados, testing, tableros de BI).

**Para un cliente o empleador potencial:** es prueba de capacidad de punta a punta —desde entender qué significa realmente un transmisor de presión en un compresor, hasta un tablero que un gerente puede leer de un vistazo—. Ese alcance completo, anclado en las particularidades de la industria gasífera argentina, es poco común.

---

## Qué demuestra técnicamente (en términos simples)

- Un generador de datos realista basado en normas reales de la industria
- Infraestructura de nube automatizada y reproducible (nada hecho a mano que no se pueda repetir)
- Una base de código testeada y profesional (160 pruebas automatizadas)
- Un diseño consciente del costo (funciona por menos de USD 1/mes)
- Separación limpia entre datos crudos, resúmenes curados y tableros

---

*Para la arquitectura técnica, ver [ARCHITECTURE.md](ARCHITECTURE.md). Para la especificación completa de señales, ver [SIMULATOR_SPEC.md](SIMULATOR_SPEC.md).*
