# MODULUS: Vehicle Customization & Engineering Specification

Every component in **Modulus** is a physical trade-off. There is no single "maxed out" car—only the optimal balance of **mass, grip, power, thermals, aero, and budget** for a specific 3D circuit layout.

---

## 1. Visual Vehicle Blueprint (Hardpoint Map)

When the player enters the **Engineering Lab**, the sunlit *Art of Rally* track lighting transitions into a high-contrast dark studio bay. Hovering or tapping any subsystem highlights its 3D hardpoint, live Center of Gravity (CG) shift, and aero/thermal vectors.

```text
                        [ FRONT OF VEHICLE ]
                                 |
                    +------------+------------+
                    |  [7A] FRONT SPLITTER    |  <-- Front Downforce / Drag
                    |  [6C] BRAKE DUCTS       |  <-- Brake Cooling vs Aero Drag
           +--------+-------------------------+--------+
           | [5] FL |   [6] BRAKES & HUBS     | [5] FR |
           | WHEEL  |---[4] FRONT SUSPENSION--| WHEEL  |
           | & TIRE |      [8B] RADIATOR      | & TIRE |
           +--------+-------------------------+--------+
                    |                         |
                    |  [2] ENGINE BAY / ECU   |  <-- Position shifts by Chassis
                    |  [2B] FORCED INDUCTION  |      (FF / FR / MR / RR / AWD)
                    |  [3A] GEARBOX & CLUTCH  |
           +--------+-------------------------+--------+
           | [7C]   |                         | [7C]   |
           | SIDE   |    [1] CHASSIS CORE     | SIDE   |
           | SKIRT  |    & WEIGHT BALLAST     | SKIRT  |
           |        |    [8A] FUEL CELL       |        |
           +--------+-------------------------+--------+
           | [5] RL |   [3B] DIFFERENTIAL     | [5] RR |
           | WHEEL  |---[4] REAR SUSPENSION---| WHEEL  |
           | & TIRE |   [6] BRAKES & HUBS     | & TIRE |
           +--------+-------------------------+--------+
                    |  [2C] EXHAUST SYSTEM    |
                    |  [7D] REAR DIFFUSER     |  <-- Clean Ground-Effect Downforce
                    |  [7E] REAR WING / AERO  |  <-- High Downforce / High Drag
                    +------------+------------+
                                 |
                        [ REAR OF VEHICLE ]
```

---

## 2. Core Physics Coupling & Live Admin Math-Biasing

Every slider and material feeds directly into the 120Hz Rapier3D + Custom Vehicle Solver, modulated in real time by the active `global_balance_config.physics_bias` scalars from Cloudflare KV:

* **Total Mass, Inertia & Center of Gravity (CG):**
  $$m_{\text{total}} = \sum_{i} m_i, \quad \vec{r}_{\text{CG}} = \frac{1}{m_{\text{total}}} \sum_{i} m_i \vec{r}_i, \quad I_{\text{eff}} = I_{\text{base}} \cdot \beta_{\text{inertia}}$$
* **Aerodynamic Downforce & Drag:**
  $$F_{\text{down}} = \frac{1}{2} \rho v^2 A C_L \cdot \beta_{\text{downforce}}, \quad F_{\text{drag}} = \frac{1}{2} \rho v^2 A C_D \cdot \beta_{\text{drag}}$$
* **Dynamic Tire Load & Pacejka Grip:**
  Longitudinal and lateral weight transfer shift normal load $F_z$ across all four contact patches dynamically based on CG height $h_{\text{CG}}$, track width $W$, and wheelbase $L$:
  $$\Delta F_{z,\text{lat}} = \frac{m_{\text{total}} \cdot a_{\text{lat}} \cdot h_{\text{CG}}}{W}, \quad \mu_{\text{eff}} = \mu_{\text{Pacejka}}(\alpha, \kappa, T_{\text{tire}}) \cdot \beta_{\text{grip}}$$
* **Thermal Balance (Engine, Brakes, Tires):**
  $$\frac{dT}{dt} = \frac{P_{\text{heat}} \cdot \beta_{\text{heat}} - k_{\text{cool}}(v) \cdot (T - T_{\text{ambient}})}{C_{\text{thermal}}}$$

---

## 3. Complete Modular Part & Tuning Breakdown

### Module 1: Chassis & Monocoque
*Defines the physical skeleton, drivetrain layout, hardpoint coordinates, and torsional rigidity.*

| Parameter | Options / Range | Step | Engineering Trade-Off (Ups vs. Downs) |
| :--- | :--- | :--- | :--- |
| **Drivetrain Layout** | `FF`, `FR`, `MR`, `RR`, `AWD` | Discrete | **FF:** Cheap, forgiving, understeer under power. **MR:** Razor turn-in, snap oversteer. **AWD:** Launch grip, heavy + drivetrain power loss ($-12\%$). |
| **Frame Material** | `Mild Steel`, `Chromoly`, `Aluminum`, `Carbon Monocoque` | Discrete | Lighter & stiffer increases suspension precision and lap pace, but cost scales exponentially ($1\text{x} \to 18\text{x}$). |
| **Wheelbase ($L$)** | $2.20\text{ m} - 2.95\text{ m}$ | $0.05\text{ m}$ | Short = nimble hairpins, twitchy at high speed. Long = high-speed stability, sluggish in tight chicanes. |
| **Track Width ($W$)** | $1.50\text{ m} - 2.00\text{ m}$ | $0.02\text{ m}$ | Wider reduces lateral weight transfer (more corner grip) but increases frontal area $A$ (more drag). |
| **Roll Cage Spec** | `None`, `Half-Cage`, `Full FIA Welded` | Discrete | Adds $+18\text{ kg}$ to $+42\text{ kg}$ high in the car (raises $h_{\text{CG}}$), but boosts chassis torsional rigidity by $+40\%$. |
| **Ballast Mass** | $0\text{ kg} - 100\text{ kg}$ | $5\text{ kg}$ | Used to meet regulation caps or fix bad weight balance. |
| **Ballast Position (X)** | $-1.0$ (Full Rear) to $+1.0$ (Full Front) | $0.05$ | Shifts Front/Rear weight percentage (e.g., tuning a nose-heavy FR car toward $50/50$). |

---

### Module 2: Engine & Powertrain
*Generates the live RPM-to-Torque curve, rotational inertia, and thermal load.*

| Parameter | Options / Range | Step | Engineering Trade-Off (Ups vs. Downs) |
| :--- | :--- | :--- | :--- |
| **Engine Layout** | `I4`, `Flat-4`, `I6`, `V6`, `V8`, `Rotary` | Discrete | **Flat-4:** Ultra-low $h_{\text{CG}}$. **V8:** Massive low-end torque, heavy. **Rotary:** Tiny, light, $9500\text{ RPM}$, terrible fuel efficiency & heat. |
| **Displacement** | $1.3\text{ L} - 6.2\text{ L}$ | $0.1\text{ L}$ | More displacement = broader torque curve, heavier block, higher fuel burn. |
| **Block Material** | `Cast Iron`, `Aluminum Alloy`, `Billet Magnesium` | Discrete | Iron handles massive turbo boost cheaply; Magnesium slashes front mass ($-35\text{ kg}$) but melts easily under sustained overheat. |
| **Aspiration** | `Naturally Aspirated`, `Single Turbo`, `Twin-Turbo`, `Supercharger` | Discrete | **NA:** Instant throttle response. **Turbo:** Huge peak power, turbo lag (scaled by $\beta_{\text{turbo}}$), heat spike. **Supercharger:** Linear boost, parasitic crank loss. |
| **Turbo Boost Pressure** | $0.3\text{ bar} - 2.5\text{ bar}$ ($4 - 36\text{ PSI}$) | $0.1\text{ bar}$ | Cranking boost skyrockets power, but spikes engine temp $T_{\text{eng}}$ and accelerates wear. |
| **Camshaft Profile** | `Street` ($0.0$) to `Race High-Lift` ($1.0$) | $0.1$ | Shifts peak torque higher up the RPM band; sacrifices low-RPM pull for screaming top-end horsepower. |
| **Rev Limiter** | $5500\text{ RPM} - 10000\text{ RPM}$ | $250\text{ RPM}$ | Higher rev limit extends gear reach, but exponentially increases thermal generation above redline. |
| **Exhaust Material** | `Steel`, `Stainless`, `Titanium`, `Inconel` | Discrete | Titanium/Inconel save rear-overhang weight and flow better ($+3\%$ to $+6\%$ power) at high credit cost. |
| **ECU Tune Map** | `Eco / Endurance`, `Balanced`, `Qualifying Attack` | Discrete | Attack mode enriches fuel/ignition timing for $+5\%$ power at $+25\%$ fuel burn and faster overheating. |

---

### Module 3: Drivetrain & Gearbox
*Translates engine torque to the driven axles.*

| Parameter | Options / Range | Step | Engineering Trade-Off (Ups vs. Downs) |
| :--- | :--- | :--- | :--- |
| **Gearbox Type** | `5-Spd H`, `6-Spd H`, `6-Spd Sequential`, `7-Spd Dual-Clutch` | Discrete | Sequential/DCT cut shift times from $220\text{ ms}$ down to $25\text{ ms}$, keeping turbo spooled, but cost more and add mass. |
| **Final Drive Ratio** | $2.80 - 5.20$ | $0.05$ | Higher ratio = explosive acceleration, lower top speed. Lower ratio = long highway legs, sluggish corner exits. |
| **Gear Ratios (G1 - G7)** | $0.65 - 4.00$ per gear | $0.02$ | Fine-tune spacing so the engine stays inside its powerband on every straight of the target circuit. |
| **Flywheel Mass** | $3.5\text{ kg}$ (Carbon) $- 12.0\text{ kg}$ (Steel) | $0.5\text{ kg}$ | Light flywheel revs and heel-toe blips instantly; heavy flywheel resists stalling and smooths drivetrain shock. |
| **Differential Type** | `Open`, `1-Way LSD`, `1.5-Way LSD`, `2-Way LSD`, `Torsen` | Discrete | Open spins the inside wheel out of corners. 2-Way locks on both accel and braking (great for drifting/stability, induces entry understeer). |
| **Diff Accel Lock** | $10\% - 100\%$ | $5\%$ | Higher lock puts power down harder on exit, but can snap the rear if tires break traction simultaneously. |
| **Diff Decel Lock** | $0\% - 100\%$ | $5\%$ | Higher decel lock stabilizes braking zones; lower lock lets the nose rotate more freely into hairpins. |

---

### Module 4: Suspension & Alignment Geometry
*Controls how the four tires stay planted over 3D elevation, banking, and kerbs.*

| Parameter | Options / Range | Step | Engineering Trade-Off (Ups vs. Downs) |
| :--- | :--- | :--- | :--- |
| **Suspension Layout** | `MacPherson Strut`, `Double Wishbone`, `Pushrod Inboard` | Discrete | Double Wishbone/Pushrod maintain better camber curves under compression and lower unsprung mass. |
| **Ride Height (F / R)** | $45\text{ mm} - 140\text{ mm}$ | $5\text{ mm}$ | Lower = lower $h_{\text{CG}}$ and stronger diffuser ground effect, but risks bottoming out over kerbs (instant grip loss). |
| **Spring Rate (F / R)** | $30\text{ N/mm} - 220\text{ N/mm}$ | $5\text{ N/mm}$ | Stiff = sharp response and aero platform stability; too stiff skips over bumpy 3D tracks and kills mechanical grip. |
| **Damper Bump (F / R)** | $1 - 20$ clicks | $1$ | Controls compression speed over bumps/kerbs and dive under braking. |
| **Damper Rebound (F / R)** | $1 - 20$ clicks | $1$ | Controls how fast the chassis unloads weight; high front rebound keeps the nose tucked in mid-corner. |
| **Anti-Roll Bar (F / R)** | $10\text{ N/mm} - 120\text{ N/mm}$ | $5\text{ N/mm}$ | Stiffening Front ARB induces understeer; stiffening Rear ARB induces oversteer. Primary balance tuning tool. |
| **Camber (F / R)** | $-5.0^\circ$ to $0.0^\circ$ | $0.2^\circ$ | Negative camber maximizes contact patch during hard cornering, but reduces straight-line braking/launch grip and wears inner tire edge. |
| **Toe Angle (F / R)** | $-1.0^\circ$ (Out) to $+1.0^\circ$ (In) | $0.05^\circ$ | Front toe-out sharpens turn-in; Rear toe-in stabilizes throttle exit. Excess toe causes drag and tire scrub heat. |
| **Caster Angle (Front)** | $2.0^\circ - 9.0^\circ$ | $0.5^\circ$ | Higher caster adds dynamic camber when steering and stronger self-centering force. |

---

### Module 5: Wheels & Tires
*Directly drives the Pacejka slip-angle and slip-ratio curves.*

| Parameter | Options / Range | Step | Engineering Trade-Off (Ups vs. Downs) |
| :--- | :--- | :--- | :--- |
| **Rim Material** | `Steel`, `Cast Alloy`, `Forged Alloy`, `Magnesium`, `Carbon` | Discrete | Slashes **unsprung & rotational mass**—makes suspension react faster and improves acceleration/braking disproportionately. |
| **Rim Diameter** | $15\text{ in} - 20\text{ in}$ | $1\text{ in}$ | Larger rims clear huge brake rotors and stiffen sidewall response, but weigh more. |
| **Tire Width (F / R)** | $195\text{ mm} - 345\text{ mm}$ | $10\text{ mm}$ | Wider = larger contact patch (more mechanical grip), but heavier, higher rolling resistance, and slower to reach optimal temperature. |
| **Sidewall Profile** | $30\% - 60\%$ | $5\%$ | Low profile = crisp steering feel, sudden breakaway at the limit. Tall profile = progressive, forgiving slip. |
| **Tire Compound** | `Street`, `Semi-Slick`, `Hard Slick`, `Med Slick`, `Soft Slick`, `Wet` | Discrete | Soft Slicks have massive peak friction $\mu \approx 1.65$ in a narrow $85^\circ\text{C}-105^\circ\text{C}$ window, but shred in 4 laps. Street tires work cold ($\mu \approx 1.05$) and last forever. |
| **Cold Tire Pressure** | $20\text{ PSI} - 38\text{ PSI}$ | $0.5\text{ PSI}$ | Low PSI builds heat faster and widens patch; too low causes squirm. High PSI reduces rolling resistance but shrinks contact patch. |

---

### Module 6: Brakes & Thermal Cooling
*Manages kinetic energy dissipation without locking wheels or suffering thermal fade.*

| Parameter | Options / Range | Step | Engineering Trade-Off (Ups vs. Downs) |
| :--- | :--- | :--- | :--- |
| **Rotor Diameter** | $280\text{ mm} - 400\text{ mm}$ | $20\text{ mm}$ | Bigger rotors = more braking torque and thermal capacity, but adds rotational mass and requires larger rims. |
| **Rotor Material** | `Cast Iron`, `Slotted Steel`, `Carbon-Ceramic` | Discrete | Carbon-Ceramic cuts unsprung weight by $50\%$ and resists fade up to $900^\circ\text{C}$, but has weak bite when cold ($<250^\circ\text{C}$). |
| **Caliper Pistons** | `2-Pot`, `4-Pot`, `6-Pot`, `8-Pot Monoblock` | Discrete | More pistons = stronger clamping force and finer pedal modulation. |
| **Brake Bias (Front %)** | $50\% - 75\%$ | $1\%$ | Too far forward = front lockup/understeer. Too far rear = instant spin under heavy braking. |
| **Brake Duct Opening** | $0\% - 100\%$ | $10\%$ | Open ducts cool brakes rapidly on heavy-braking circuits, but add aerodynamic drag ($+C_D$) and can over-cool Carbon-Ceramic pads. |

---

### Module 7: Aerodynamics & Bodywork
*Shapes airflow to trade straight-line top speed for high-speed cornering G-forces.*

| Parameter | Options / Range | Step | Engineering Trade-Off (Ups vs. Downs) |
| :--- | :--- | :--- | :--- |
| **Body Panel Material** | `Steel`, `Fiberglass`, `Kevlar`, `Dry Carbon Fiber` | Discrete | Reduces overall curb weight and lowers $h_{\text{CG}}$ at increasing credit cost. |
| **Front Splitter** | `None`, `Street Lip`, `Track Blade`, `GT Pro` | Discrete | Generates front downforce; requires matching rear aero or the car will snap-oversteer in fast sweepers. |
| **Rear Diffuser** | `None`, `Shallow Strakes`, `Deep Venturi` | Discrete | High-efficiency downforce (very low drag penalty), but **stalls** if ride height is too high or too low. |
| **Rear Wing Type** | `None`, `Ducktail`, `GT Wing`, `Swan-Neck Dual Element` | Discrete | Massive rear stability at speed; biggest contributor to drag $C_D$. |
| **Wing Angle of Attack** | $0^\circ - 20^\circ$ | $1^\circ$ | Live slider to tune the car's Drag-to-Downforce ratio per track (e.g., $2^\circ$ for Monza-style straights, $16^\circ$ for tight mountain switchbacks). |

---

### Module 8: Fuel & Radiator
*Endurance and thermal headroom tuning.*

| Parameter | Options / Range | Step | Engineering Trade-Off (Ups vs. Downs) |
| :--- | :--- | :--- | :--- |
| **Fuel Load** | $5\text{ L} - 80\text{ L}$ | $5\text{ L}$ | Fuel weighs $0.75\text{ kg/L}$ and burns dynamically during laps, making the car progressively faster as the tank empties. |
| **Radiator Core Size** | `Compact`, `Standard`, `Dual-Pass Aluminum`, `Endurance Spec` | Discrete | Prevents high-boost engines from entering limp mode or blowing up, at the cost of front nose weight and grille drag. |

---

## 4. Gamified Telemetry UX (Desktop & Mobile Friendly)

Instead of forcing players to read raw spreadsheets, the **Engineering Lab** visualizes all 8 modules through four instant-read responsive widgets:
1. **The Spider-Balance Diamond:** Live 0–100 bars for *Acceleration, Top Speed, Cornering G, Braking, Thermal Stability, and Aero Efficiency*.
2. **Live Virtual Dyno Graph:** Plots **Torque (Nm)** and **Power (HP)** vs. RPM, with vertical lines showing each gear's shift-drop zone.
3. **Weight & Aero Balance Overlay:** Directly on the 3D car in the dark lab—shows `F: 48% / R: 52%`, CG glowing orb height, and glowing cyan downforce arrows vs. red drag vectors.
4. **Plain-English Warning Badges:** Automatic engineering alerts (e.g., *"Aero Imbalance: High Front Downforce will cause High-Speed Oversteer"*, *"Thermal Risk: Boost exceeds Compact Radiator capacity"*).