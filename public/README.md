# Frontend Application

The `/public` directory hosts the client-side of the Vistara platform.
It is an entirely vanilla JavaScript (ES Modules), HTML5, and CSS3 application without heavy build steps like Webpack or React.

- `index.html`: The single-page application entry point.
- `styles.css`: Custom styling built from scratch using CSS Variables.
- `app.js`: Main logic orchestrator, managing state, authentication, and view switching.
- `canvasViewport.js`, `dashboard-layout.js`: Logic to handle the drag-and-drop dashboard grid.
- `vendor/`: Self-hosted third-party libraries (GridStack.js for layouts, Chart.js for data visualization).
