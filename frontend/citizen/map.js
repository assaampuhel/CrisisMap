// Initializes Google Map and places a draggable marker at user's current location.
// Exposes window.currentLocation = {lat, lng}
let map, marker;

function initMap() {
  // default fallback location (if geolocation denied)
  const defaultLoc = { lat: 23.5899, lng: 58.3829 }; // Muscat-ish

  // Try geolocation first
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        _createMap(loc);
      },
      err => {
        console.warn("Geolocation failed or denied, using default", err);
        _createMap(defaultLoc);
      },
      { timeout: 7000 }
    );
  } else {
    _createMap(defaultLoc);
  }
}

function _createMap(center) {
  map = new google.maps.Map(document.getElementById("map"), {
    center,
    zoom: 15,
    mapTypeControl: false,
    fullscreenControl: false,
  });

  marker = new google.maps.Marker({
    position: center,
    map,
    draggable: true,
    title: "Drag to refine exact location",
  });

  window.currentLocation = center;

  // Update window.currentLocation when marker moves
  marker.addListener("dragend", () => {
    const pos = marker.getPosition();
    window.currentLocation = { lat: pos.lat(), lng: pos.lng() };
  });
}
