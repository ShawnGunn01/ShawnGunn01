// Checklist content for Raw Development Design, New Build Selections.
//   "Label|opt;opt"  choice (single)      "*Label|opt;opt" choice (pick all that apply)
//   "Label|"         write-in             "Label|~hint"    write-in with hint
//   Options starting with "Other" open a write-in box. Shared by the browser app and the server.
const ROOMS = [
 {id:'kitchen', name:'Kitchen', sections:[
  ['Cabinets and hardware',['Cabinet construction|RTA;Custom;To select','Door style|Shaker;Slab;Other','Cabinet color or finish|','Hardware|Pulls;Knobs;Combination;To select','Hardware finish and size|','Backside of island|Storage cabinets;Finished panels;To select']],
  ['Sink and plumbing',['Kitchen sink|Single basin;Double basin;Farmhouse;To select','Sink size, material, brand and model|','Kitchen faucet|Single handle;Pull down;Other','Faucet finish, brand and model|','Garbage disposal|Yes;No;To select','Disposal control|Air switch;Wall switch;To select','Soap dispenser|Yes;No;To select','*Cord or pigtail connection|Disposal;Dishwasher;Other;To confirm','Plumbing and accessory notes|']],
  ['Lighting and electrical',['Under cabinet lights|Yes;No;To select','Toe kick lights|Yes;No;To select','Island pendant lights|Yes;No;To select','Pendant quantity, location and fixture model|']],
  ['Refrigerator and freezer',['Configuration|36 in. counter depth;Separate refrigerator and freezer columns;Other','Column finish|Panel ready;Stainless;Other;Not applicable','Refrigerator width and model|','Freezer width and model|']],
  ['Oven and range',['Wall oven|Single;Double;Microwave and oven combination;None','Oven power|Electric;Gas;To select','Wall oven width, brand and model|','Range or cooktop|Range;Cooktop;None;To select','Cooking fuel|Gas;Electric;Induction;To select','Range or cooktop size, brand and model|','Recessed gas box|Requested;Not applicable;Location to confirm']],
  ['Microwave and ventilation',['Microwave|Drawer;Built in with trim kit;Oven combination;None','Microwave size, brand and model|','Hood type|Chimney style;Insert;Other;To select','Hood width, vent size and model|']],
  ['Dishwasher',['Dishwasher|24 in.;Other width;None','Dishwasher front|Panel ready;Stainless;Other','Dishwasher brand and model|','Supply line and cord or pigtail|To be included;To confirm with installer']],
  ['Countertops, backsplash and island',['Countertop material|Quartz;Quartzite;Marble;Other stone','Countertop format|Prefab;Slab with custom fabrication','Backsplash|Tile;Full stone;Other','Countertop edge|Waterfall;Standard edge;To select','Seating overhang|16 in.;Other;No seating','Backside storage|Yes;No;To select','Island length and width|','Countertop material and color|','Backsplash material and color|']],
  ['Appliance package',['Appliance package|Builder standard;Upgrade package;Client supplied;To select','Appliance package brand and level|']],
  ['Kitchen extras',['Pot filler|Yes;No;To select','Wine or beverage fridge|Yes;No;To select','Beverage fridge size and model|','Trash pullout|Single;Double;None;To select','Upper cabinet height|To ceiling;With crown molding;Standard height;To select','Pantry shelving|Cabinet pantry;Walk-in shelving;None;To select','Under-sink water filter|Yes;No;To select','Water filter type and model|']]
 ]},
 {id:'laundry', name:'Laundry', sections:[
  ['Laundry selections',['Washer and dryer layout|Stackable;Side by side;To select','Cabinets|Cabinets for stacked units;Upper cabinets for side by side;None','Folding surface|Stone folding counter;Other;None','Recessed laundry box with hammer arrestors|Yes;To confirm','Recessed dryer vent|Yes;To confirm','Panasonic humidity sensing vent fan|Yes;To select','Vacancy sensor light switch|Yes;To select','Laundry sink|Yes;No;To select','Laundry sink size and faucet model|','Washer and dryer model and size|']]
 ]},
 {id:'bath', name:'Bathrooms', one:'Bathroom', repeat:true, defaults:['Primary bath','Bathroom 2'],
  intro:'Each bathroom gets its own full set of selections. Add a tab for every bathroom in the house, or duplicate one that shares most of the same finishes and change only what differs.',
  sections:[
  ['Finishes',['Fixture and hardware finish|Nickel;Chrome;Matte black;Gold']],
  ['Vanity and countertop',['Vanity type|Custom;Stock;To select','Vanity width|24 in.;36 in.;48 in.;60 in.;72 in.;Other','Number of sinks|Single;Double','Vanity style|Pedestal;Floating;Legs;Base cabinet','Sink style|Undermount;Top mount;Vessel;Trough','Sink location|Left hand;Right hand;Center;Not applicable','Countertop|Prefab;Quartz;Stone;Other','Faucet|4 in. centerset;Widespread;Single hole;Wall mount','Backsplash height|4 in.;6 in.;Full enclosure;Other','Backsplash extent|One wall;Two walls;Other','Counter edge|Mitered;Bullnose;Other','Vanity finish and faucet model|']],
  ['Mirror, medicine cabinet and lighting',['Mirror shape|Rectangular;Circular;Oval','Mirror size|','Medicine cabinet|Recessed;Surface mount;None','Medicine cabinet power|Yes;No;To confirm','Medicine cabinet size and model|','Vanity lighting|Sconce;Pendant;Vanity light','Light quantity and fixture model|']],
  ['Toilet',['Height|Comfort height;Regular height','Bowl and mounting style|Round;Elongated;Wall mount','Construction|One piece;Two piece;To select','Electric toilet or bidet|Yes;No;To select','GFCI outlet for toilet|Yes;No;To confirm','Toilet brand and model|']],
  ['Tub and tub shower',['Tub size|30 x 60 in.;32 x 60 in.;Other;No tub','Tub material|Cast iron;Acrylic;Other','Tub style|Soaking;Jetted or Jacuzzi;Other','Installation|Alcove;Drop in;Freestanding','Alcove drain side|Left hand;Right hand;Not applicable','Tub shower combo|Yes;No','*Tub shower fixtures|Shower head;Hand shower;Rain shower','Tub shower diverter|Two function;Three function;To confirm','Tub filler|Wall mount;Deck mount;Freestanding;To select','Tub and filler brand and model|']],
  ['Shower fixtures',['Shower configuration|Shower only;Tub shower combo;No shower','Fixture side|Right hand;Left hand;To confirm','*Shower fixtures|Shower head;Hand shower;Rain shower','Diverter|Two function;Three function;To confirm','Shower head height (in.)|~80 in. target','Valve height (in.)|~36 to 48 in. range','Valve and fixture models|']],
  ['Shower drain and curb',['Drain layout|Point drain;Linear drain','Point drain shape|Round;Square;Not applicable','Drain cover|Grate;Tile in;To select','Linear drain length|18 in.;24 in.;36 in.;Other;Not applicable','Shower entry|Curb;Curbless;To confirm']],
  ['Shower additions',['Bench|Corner;Straight, about 21 x 12 in.;None','Niche|Yes;No;To select','Niche width, height and location|','Niche orientation|Vertical;Horizontal','Niche LED lights|Yes;No;To select']],
  ['Shower enclosure and steam',['Enclosure|Frameless 3/8 in. glass;Slider;Splash guard;Other','Door height (in.)|','Door handle|Yes;No;To select','Door hinge|Left;Right;Not applicable','Splash guard width|30 in.;36 in.;Other;Not applicable','Enclosure hardware finish|Nickel;Chrome;Matte black;Gold','Steam unit|Yes;No;To select','Steam unit brand and model|']],
  ['Bathroom tile',['*Tile areas|Shower walls;Shower pan;Bench;Bathroom floor','*Additional tile|Ceiling for steam shower;Other','Wall tile layout|Brick lay;Vertical stack;Subway;Large format','Tile edge|Mitered;Schluter trim;Other','Wall tile and grout selection|','Floor and shower pan tile selection|']],
  ['Ceiling lights and ventilation',['Humidity sensing exhaust fan|Yes;To select','Exhaust fan model|','Recessed lights|Yes;No;To select','Recessed light quantity and locations|']],
  ['Comfort upgrades and accessories',['Heated floors|Yes;No;To select','Towel warmer|Hardwired;Plug-in;None;To select','Towel warmer model|','*Accessories|Towel bars;Towel ring;Toilet paper holder;Robe hooks','Accessory finish and models|']]
 ]},
 {id:'bed', name:'Bedrooms', one:'Bedroom', repeat:true, defaults:['Primary bedroom','Bedroom 2'],
  intro:'Each bedroom gets its own selections. Add a tab for every bedroom, or duplicate one and adjust.',
  sections:[
  ['Lighting and electrical',['Ceiling light|Yes;No;To select','Recessed lights|Yes;No;To select','Recessed light quantity and locations|','Ceiling fan|Yes;No;To select','Ceiling fan size and model|','Light switch control|On and off;Dimmer;To select','*Smoke detector|Location to confirm;Model to select','TV wiring|Yes;No;To select','TV location and wiring notes|']],
  ['Trim and closet',['Baseboard and casing|House standard;Custom profile;To select','Baseboard and casing style and size|','Closet type|Reach-in;Walk-in;To select','Walk-in closet layout notes|','Closet storage|Single pole with shelf;Double pole with shelves','Closet organizer|Custom organizer;None;To select','Closet door|Slider;Bifold;French doors with ball catches;Soft-close pocket door','Closet door size and finish|']]
 ]},
 {id:'living', name:'Living room', sections:[
  ['Living room selections',['Recessed lights|Yes;No;To select','Recessed light quantity and locations|','Ceiling fan|Yes;No;To select','Ceiling fan size and model|','LED accent lights|Yes;No;To select','LED light locations|','TV wiring|Yes;No;To select','TV location and wiring notes|','Fireplace|Yes;No;To select','Fireplace fuel|Gas;Electric;Wood-burning;Not applicable','Fireplace size and style|','Baseboard style and size|','Flooring|Hardwood;Laminate;Vinyl;Tile;To select','Flooring product and color|']]
 ]},
 {id:'dining', name:'Dining room', sections:[
  ['Dining room selections',['Recessed lights|Yes;No;To select','Recessed light quantity and locations|','Ceiling fan|Yes;No;To select','Ceiling fan size and model|','LED accent lights|Yes;No;To select','LED light locations|','Fireplace|Yes;No;To select','Fireplace fuel|Gas;Electric;Wood-burning;Not applicable','Fireplace size and style|','Baseboard style and size|','Flooring|Hardwood;Laminate;Vinyl;Tile;To select','Flooring product and color|']]
 ]},
 {id:'powder', name:'Powder room', sections:[
  ['Vanity, sink and mirror',['Vanity|Custom;Stock;To select','Vanity size and style|','Sink|Integrated custom sink;Undermount;Other','Vanity mirror|Yes;No;To select','Mirror shape and size|','Faucet mounting|Wall mount;Deck mount;To select','Faucet finish and model|']],
  ['Lighting',['Pendant light|Yes;No;To select','Pendant quantity and location|','Recessed lights|Yes;No;To select','LED accent lights|Yes;No;To select','Light quantity and locations|']],
  ['Toilet',['Toilet mounting|Floor mount;Wall hung;To select','Electric toilet or bidet|Yes;No;To select','Toilet height|Comfort height;Regular height','Toilet brand and model|']],
  ['Walls, trim and ventilation',['Wallpaper|Yes;No;To select','Wallpaper selection and walls|','Wainscoting|Yes;No;To select','Wainscoting height and style|','Humidity sensing vent fan|Yes;No;To select','Vent fan model|','Baseboard and casing style and size|']]
 ]},
 {id:'elec', name:'Electrical', sections:[
  ['Electrical selections',['*Smoke alarms per applicable code|Locations to confirm;Models to confirm','Smoke alarm locations|','*Carbon monoxide alarms per applicable code|Locations to confirm;Models to confirm','Carbon monoxide alarm locations|','Light dimmers|Yes;No;To select','Rooms and switches requiring dimmers|','Caseta smart home upgrade|Yes;No;To select','Smart controls and rooms|']],
  ['Specialty lighting',['Sconces|Yes;No;To select','Sconce quantity and locations|','Pendant lights|Yes;No;To select','Pendant quantity and locations|','LED accent lights|Yes;No;To select','LED quantity and locations|','*Entry, hallway and stair lighting|Recessed;Pendant or chandelier;Sconces;Step lights','Entry, hallway and stair fixture locations and models|']]
 ]},
 {id:'floor', name:'Flooring and trim', sections:[
  ['Flooring and trim selections',['*Flooring type|Engineered hardwood;Vinyl;Laminate;Carpet;Other','Rooms and floors for each material|','Flooring product, color and plank size|','Second floor cork underlayment|Yes;No;Confirm if needed','Cork thickness and rooms if selected|','Baseboard size and style|','Match baseboard to casing|Yes;No;To select','Casing size and style|']],
  ['Crown molding, built-ins and ceilings',['Crown molding|Yes;No;To select','Crown molding rooms and profile|','Built-ins|Yes;No;To select','Built-in locations and descriptions|','*Ceiling details|Coffered;Beamed;Tray;None','Ceiling detail rooms|']]
 ]},
 {id:'paint', name:'Painting', sections:[
  ['Painting selections',['Interior walls|Sherwin-Williams flat;Other finish','Wall paint color and product|','Ceilings|Flat;Other finish','Ceiling paint color and product|','Baseboard, casing and trim|Satin;Other finish','Trim paint color and product|','Bathroom walls|Sherwin-Williams Duration satin;Other','Bathroom paint color and exceptions|']]
 ]},
 {id:'front', name:'Front door', sections:[
  ['Style and size',['Front door style|Pivot door;Single hinged;Double doors;Single with sidelights;Other','Door material|Wood;Steel;Fiberglass;Aluminum and glass;Other','Door size|36 x 80 in.;36 x 96 in.;42 x 96 in.;48 x 108 in.;Other','Door width and height (in.)|','Glass|Full glass;Partial glass;No glass;To select']],
  ['Opening',['Door opening|Inswing;Outswing;To confirm','Hinge or pivot side|Left hand;Right hand;To confirm','Pivot location|Offset pivot;Center pivot;Not applicable','Door closer or soft stop|Yes;No;To select']],
  ['Lock and hardware',['Electric door lock|Yes;No;To select','*Lock features|Keypad;Fingerprint;Smartphone app;Key backup','Power or low-voltage wiring to lock|Yes;No;To confirm','Door handle|Pull handle;Lever;Handleset;To select','Hardware finish|Black;Nickel;Chrome;Gold','Door, lock and hardware brand and model|']]
 ]},
 {id:'windows', name:'Windows and patio doors', sections:[
  ['Windows',['Window line|Milgard Trinsic;Upgrade to aluminum;Upgrade to wood clad;Other','Window color|White;Black;Other;To select','Window style and color notes|','*Window opening types|Single hung;Casement;Awning;Slider;Fixed picture','Window schedule notes|~Rooms, sizes and opening type for each window']],
  ['Patio and sliding doors',['*Door types|Exterior slider;Multi sliding door;Pocket sliding door (panels hide in wall);None','Door frame|Match windows;Upgrade to aluminum;Upgrade to wood clad;To select','Door color|','Door locations, sizes and panel count|']],
  ['Window coverings',['Window coverings|Motorized shades;Manual shades;Shutters;By owner;To select','Motorized shade prewire|Yes;No;To select','Rooms for shades or coverings|']]
 ]},
 {id:'roof', name:'Roof and gutters', sections:[
  ['Roofing',['Roof type|Title 24 cool roof;Presidential shingle;Presidential TL shingle;Tile roof;Metal seam roof;Other','Roof product and color|']],
  ['Rain gutters and downspouts',['Rain gutters and downspouts|Yes;No;To select','Gutter and downspout color and material|']]
 ]},
 {id:'exterior', name:'Exterior', sections:[
  ['Stucco',['Stucco finish|Sand finish;Upgrade to smooth finish;Other','Stucco color|']],
  ['Exterior electrical',['Exterior sconces|Yes;No;To select','Sconce quantity, locations and model|','Security cameras|Yes;No;To select','Camera quantity and locations|','Doorbell camera|Yes;No;To select','Doorbell camera model|']],
  ['Other exterior doors',['*Door locations|Side door;Back door;Garage entry door;None','Door style|Full glass;Half glass;Solid panel;To select','Door material and color|']],
  ['Exterior colors and details',['Fascia and eave color|','Exterior trim color|','House number style and finish|','Mailbox|Wall mount;Post mount;Column;To select']]
 ]},
 {id:'fire', name:'Fire hardening',
  intro:'Wildfire building code requirements depend on the fire hazard zone for this address. Mark each item as required, as an upgrade, or not selected so every choice is on record.',
  sections:[
  ['Fire hazard zone',['Fire hazard zone for this address|Very high;High;Not in a mapped zone;To confirm','Zone and code notes|']],
  ['Vents, eaves and attic',['Ember and flame resistant vents (attic, eave, crawlspace)|Required at this address;Upgrade;Not selected','Vent brand and model|','Unvented attic with spray foam (no attic vents)|Required at this address;Upgrade;Not selected','Enclosed or boxed eaves, noncombustible soffits|Required at this address;Upgrade;Not selected']],
  ['Roof and gutters',['Class A roof assembly|Required at this address;Upgrade;Not selected','Eave closures (bird stops) at tile roof|Required at this address;Upgrade;Not selected;Not applicable','Metal gutter guards|Required at this address;Upgrade;Not selected']],
  ['Windows, skylights and doors',['Dual pane windows with a tempered pane|Required at this address;Upgrade;Not selected','Tempered skylights|Required at this address;Upgrade;Not selected;Not applicable','Solid core or noncombustible exterior doors|Required at this address;Upgrade;Not selected','Garage door weather seal|Required at this address;Upgrade;Not selected']],
  ['Decks, fences and the first five feet',['Noncombustible or ignition-resistant decks, pergolas and patio covers|Required at this address;Upgrade;Not selected;Not applicable','Metal fence or gate section where fences meet the house|Required at this address;Upgrade;Not selected;Not applicable','Noncombustible ground band, 0 to 5 ft from house|Required at this address;Upgrade;Not selected','Ground band material|Gravel;Concrete;Pavers;To select']]
 ]},
 {id:'lowv', name:'Low voltage', sections:[
  ['Low voltage upgrade',['Low voltage upgrade|Yes;No;To select','*Wire for|Cameras;Speakers;Internet extender;Motorized shades;Other','Speaker rooms and locations|','Camera and internet extender locations|']]
 ]},
 {id:'insul', name:'Insulation and drywall', sections:[
  ['Insulation',['*Title 24 insulation|Exterior walls;Floors;Attic or roof','*Insulation upgrades|Interior wall insulation;Rockwool;None;To select','Upgrade rooms and walls|']],
  ['Drywall',['Drywall|5/8 in. drywall, level 4 smooth finish;Other','Drywall notes|']]
 ]},
 {id:'hvac', name:'HVAC and water heating', sections:[
  ['Heating and cooling',['System type|Gas furnace with AC;Heat pump;To select','Distribution|Ducted;Ductless mini splits;Combination;To select','Zoning|Single zone;Multi zone;To select','Number of zones and areas|','Thermostat|Standard programmable;Smart thermostat;To select','Thermostat model|','Supply vents|Standard T-bar vents;Upgrade to linear vents;To select','Linear vent rooms and locations|','Air filtration|MERV 13;Standard;To select','Fresh-air ventilation (ERV)|Yes;No;To select']],
  ['Water heater',['Water heater|Tankless gas;Heat pump water heater;To select','Recirculation pump|Yes;No;To select','Water heater brand, model and location|']]
 ]},
 {id:'plumb', name:'Plumbing', sections:[
  ['Whole-house plumbing',['*Water treatment|Whole-house filtration;Water softener;None;To select','Water treatment model and location|','Gas stub for BBQ|Yes;No;To select','Gas stub for fire pit|Yes;No;To select','Gas stub locations|','Hose bib quantity and locations|','Outdoor shower|Yes;No;To select','Outdoor shower location and fixtures|','Leak detection with automatic water shutoff|Yes;No;To select','Leak detection model|','Pressure regulator|Yes;To confirm','Sewer or septic|Sewer, lateral inspection;Septic, evaluation;To confirm']]
 ]},
 {id:'power', name:'Power and utilities', sections:[
  ['Fuel and service',['Home fuel|All-electric;Gas and electric;To select','Electrical panel size|200A;400A;To confirm','Utility service to house|Overhead;Underground;To confirm','Meter and panel location|']],
  ['Backup and protection',['Backup power|Generator;Generator inlet with transfer switch;Battery only;None;To select','Generator or inlet size and location|','Whole-house surge protector|Yes;No;To select','Automatic seismic gas shutoff valve|Yes;Not applicable, all-electric;To confirm']]
 ]},
 {id:'solar', name:'Solar, EV and sprinklers', sections:[
  ['Solar and battery',['Solar system|Title 24 minimum;Upsized system;To select','System size and panel location|','Battery storage|Yes;No;Prewire for future;To select','Battery brand, model and location|']],
  ['EV charging',['EV charger|Charger installed;240V circuit only;None;To select','EV charger location and model|']],
  ['Fire sprinklers',['Sprinkler head style|Concealed flat cover;Standard pendant;To select','Cover plate color|White;Other']]
 ]},
 {id:'stairs', name:'Stairs and railings', sections:[
  ['Stairs',['Staircase|Yes;Single story, not applicable','Tread material|Hardwood to match floors;Stone;Tile;Carpet;Other','Riser finish|Painted;Match treads;Other','Stair lighting|Step lights;Wall sconces;None;To select']],
  ['Railings',['Railing style|Glass;Metal;Wood;Cable;Other','Railing finish and handrail material|']]
 ]},
 {id:'garage', name:'Garage', sections:[
  ['Garage door',['Garage door style|Modern flush;Carriage;Glass and aluminum;Raised panel;Other','Garage door color and size|','Garage door opener|Belt drive;Wall mount;Smart opener;To select','Opener model|']],
  ['Garage interior',['Garage floor|Epoxy;Sealed concrete;Polished concrete;To select','*Storage|Cabinets;Overhead racks;Wall system;None','Garage storage notes|']]
 ]},
 {id:'struct', name:'Site and structure', sections:[
  ['Foundation and grading',['Foundation|Slab;Raised;Per engineer, to confirm','Retaining walls|Yes;No;To confirm','Retaining wall finish and height|','Grading notes|']],
  ['Drainage',['*Drainage|Area drains;French drains;Downspouts tied to drain lines;To confirm','Drainage notes|']],
  ['Additional living space',['ADU or JADU|ADU;JADU;None;To select','ADU or JADU size and layout notes|']]
 ]},
 {id:'site', name:'Hardscape and landscape', sections:[
  ['Hardscape',['Driveway|Concrete;Pavers;Stamped concrete;Other','Driveway finish and color|','Patio|Concrete;Pavers;Stone;Wood deck;Other','Patio size and finish|','Fencing|Wood;Block wall;Metal;Horizontal slat;Other','*Gates|Pedestrian gate;Driveway gate;Motorized driveway gate;None']],
  ['Landscape',['Irrigation|Drip;Sprinklers;Combination;To select','Irrigation controller|Smart controller;Standard;To select','Landscape lighting|Yes;No;To select','Landscape lighting locations|','Landscape plan and plant notes|']],
  ['Outdoor living',['Outdoor kitchen|Yes;No;To select','Outdoor kitchen layout and appliances|','Pool|Yes;No;Future, plan only;To select','Spa|Yes;No;Future, plan only;To select','Pool and spa notes|']]
 ]},
 {id:'door', name:'Interior doors', one:'Door type', repeat:true, defaults:['Standard doors'],
  intro:'Add a tab for each door type or location, such as standard bedroom doors, a pantry pocket door, or the primary suite entry.',
  sections:[
  ['Door selections',['Door face style|Shaker;Slab;Other','Door operation|Hinged;Pocket;Bifold;Slider','Door hardware|Knob;Lever;Other','Hardware finish|Black;Nickel;Chrome;Gold','Door width (in.)|','Door height (in.)|','Door swing|Left in;Right in;Left out;Right out;Not applicable','Door and hardware brand or model|']]
 ]},
 {id:'review', name:'Final review', sections:[
  ['Final selection review',['*Client acknowledges|Items left To select after the deadline default to Raw Development standard;Changes after sign-off are priced as change orders and may affect the schedule;Long-lead items must be selected first','Additional notes or questions|']]
 ]}
];
ROOMS.forEach(r => { if(r.id !== 'review') r.sections.push(['Room sign-off',['Allowance for this room|~Set by Raw Development','Selection deadline|~Date this room must be finalized','Insurance coverage|Insurance covered;Out of pocket;Split;To confirm','Spec sheets received|Yes;Not yet;Not applicable','Client initials|']]); });
const PROJECT = {id:'project', name:'Project', sections:[['Job details',['Client name|','Project address|','Lot or APN|','Job number|','Date|']]]};
const ALL = [PROJECT, ...ROOMS];
const SOFT = new Set(['To select','To confirm','Not applicable','None','To confirm with installer','Location to confirm','Confirm if needed','No']);
const OPEN_RE = /^(To select|To confirm|To confirm with installer|Confirm if needed|Location to confirm|Locations to confirm|Models to confirm|Per engineer, to confirm)$/;
const FORM_REV = 'Form rev. Oct 2026';

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function parse(str){
  const multi = str[0]==='*'; if(multi) str = str.slice(1);
  const [label, rest] = str.split('|');
  const f = {label, key:slug(label), multi};
  if(rest==='' || rest.startsWith('~')){ f.text = true; f.hint = rest.slice(1); }
  else f.opts = rest.split(';');
  return f;
}
ALL.forEach(r => r.sections = r.sections.map(([t, fs]) => ({title:t, key:slug(t), fields:fs.map(parse)})));

const CHECKLIST = {ROOMS, PROJECT, ALL, SOFT, OPEN_RE, FORM_REV};
if (typeof module !== 'undefined' && module.exports) module.exports = CHECKLIST;
else window.CHECKLIST = CHECKLIST;
