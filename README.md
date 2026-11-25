# MasterPc

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.2.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Robot backend

The backend runs two local servers:

- HTTP API: `127.0.0.1:3000`, used by the Angular app.
- Arduino TCP link: port `5050`, bound to `0.0.0.0` by default so the board can connect over Wi-Fi.

Open two terminals in the `Master_Pc` project folder, the folder containing `package.json`. If a terminal is currently in its parent folder (`Master Pc`), first run `cd .\Master_Pc`.

In the first terminal, start the backend and leave it running:

```bash
npm run backend
```

In the second terminal, start the Angular app:

```bash
npm start
```

The map is a complete 4-by-3 grid. Nodes are numbered from 1 to 12, left to right and top to bottom. Dijkstra assigns every neighboring connection a cost of 1, so it selects a shortest route by number of segments. The top of the grid corresponds to physical east; the app rotates the compass labels to match.

Selecting a start and destination in the app calls `POST /api/robot/path`. The backend returns the shortest node sequence and turn instructions for display; this calculation does not require or command a connected robot. `ROBOT_INITIAL_HEADING` is relative to the grid (default: `up`, which corresponds to physical east).

The Arduino must connect to the computer's LAN IP on port `5050` and implement this newline-delimited TCP protocol:

1. Send `READY`; the backend replies `WELCOME`.
2. Receive `STEP <sequence> <from> <to> <turn>`, where `<turn>` is `STRAIGHT`, `LEFT`, `RIGHT`, or `UTURN`.
3. Execute that segment and send `DONE <sequence> <to>` only after reaching node `<to>`. The backend will not send the next step before this acknowledgement.
4. After the final segment, receive `ARRIVED <sequence> <destination>`, stop the motors, and reply `ARRIVED_ACK <sequence>`.

The backend returns success to the web app only after the final arrival acknowledgement. The original supplied sketch does not implement this protocol; the replacement sketch below does. The backend reports that no ready robot is connected until the replacement firmware is configured and uploaded.

The replacement sketch is in `firmware/robot_controller.ino`. Before uploading it, set `WIFI_SSID`, `WIFI_PASSWORD`, and `BACKEND_IP` to the Wi-Fi credentials and LAN address of the computer running the backend. `BACKEND_IP` must be reachable by the Arduino on port `5050`. If `ROBOT_TOKEN` is configured on the backend, set the same value in the sketch. Install/select the Arduino UNO R4 WiFi board package and tune the motor and pivot PWM values for the physical robot.

Configuration can be supplied with environment variables:

- `API_HOST` and `API_PORT` (defaults: `127.0.0.1` and `3000`)
- `ROBOT_TCP_HOST` and `ROBOT_TCP_PORT` (defaults: `0.0.0.0` and `5050`)
- `ROBOT_INITIAL_HEADING` (`up`, `right`, `down`, or `left` relative to the grid; default: `up`, physical east)
- `ROBOT_STEP_TIMEOUT_MS` (default: `120000`)
- `ROBOT_TOKEN` (optional; if set, the Arduino must send `READY <token>`)

If a robot disconnects or misses an acknowledgement, the backend marks its position as unknown. After manually checking the robot's actual node and heading, synchronize the backend with:

```http
POST /api/robot/synchronize
Content-Type: application/json

{"node": 1, "heading": "up"}
```

Run backend tests with:

```bash
npm run test:backend
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
