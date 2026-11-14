# Radar de Tendencias · Ágilex × Grown IA

Plataforma abierta de tendencias y scouting de consumidor para 15 países, que se alimenta sola.

## Cómo se alimenta

| Proceso | Frecuencia | Fuentes |
|---|---|---|
| Pulso | Cada hora | Google Trends (lo que está subiendo por país y región) y Google News (titulares por país, ciudad y público hispano de EE. UU.) |
| Sectores | Cada 6 horas | Google News: titulares de las últimas 24 h por país en 26 sectores |
| Diario | 5:15 a. m. (Colombia) | Wikipedia (lo más leído por país) y festivos oficiales |
| Análisis IA | Programado | Fichas de audiencia, jerga, semáforo de trends, hashtags y oportunidades (carpeta `data/insights/`) |

Todo corre en GitHub Actions. No hay que subir nada a mano.

## Estructura

- `config/catalogo.json`: países, ciudades, segmentos, redes y sectores. Para sumar un país o sector se edita aquí.
- `scripts/recolectar.py`: recolector (solo Python estándar).
- `data/`: datos que la página lee. Los genera el robot; no se editan a mano.
- `.github/workflows/recolectar.yml`: horarios automáticos.
