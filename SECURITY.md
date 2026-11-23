# Seguridad

## Reportar una vulnerabilidad
No abras un issue público. Usa «Report a vulnerability» en la pestaña Security de este repositorio (aviso privado de GitHub).

## Reglas del proyecto
- Ninguna clave va en el código ni en el sitio. La llamada al modelo de IA pasa por un intermediario con la clave en sus variables secretas, un límite por visitante y un tope de gasto mensual.
- El sitio es estático. No guarda datos personales de quien lo visita.
- Cada commit pasa por gitleaks en local y en GitHub Actions, y GitHub bloquea cualquier push que contenga un secreto conocido.
- Las dependencias se revisan con Dependabot cada semana. Las librerías que se cargan desde CDN llevan la versión exacta y su hash de integridad (SRI).
- Solo se usan datos abiertos con su licencia y atribución. Nada de datos personales ni de ubicaciones sensibles.
