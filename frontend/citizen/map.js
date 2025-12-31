// map.js — initializes Google Map, marker, and Places autocomplete
let map, marker, autocomplete;

window.currentLocation = null;

function initMap(){
  const fallback = { lat: 23.588, lng: 58.382 };

  map = new google.maps.Map(document.getElementById("map"), {
    center: fallback,
    zoom: 13,
    mapTypeControl: false,
    fullscreenControl: false,
  });

  marker = new google.maps.Marker({
    position: fallback,
    map,
    draggable: true,
    title: "Drag to adjust location"
  });

  // mark initial location
  window.currentLocation = fallback;

  marker.addListener("dragend", () => {
    const p = marker.getPosition();
    window.currentLocation = { lat: p.lat(), lng: p.lng() };
    // update visible location input lightly
    const li = document.getElementById("locationInput");
    if (li && li.value === "") li.placeholder = "Pin moved — optionally add a name";
  });

  // Places Autocomplete
  const input = document.getElementById("placeSearch");
  autocomplete = new google.maps.places.Autocomplete(input, { fields: ["geometry","formatted_address","name"] });
  autocomplete.bindTo("bounds", map);

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) {
      alert("No details available for the selected place.");
      return;
    }
    map.setCenter(place.geometry.location);
    map.setZoom(15);
    marker.setPosition(place.geometry.location);
    window.currentLocation = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng()
    };
    document.getElementById("locationInput").value = place.formatted_address || place.name || "";
  });

  // "Use my location" button
  document.getElementById("locBtn").addEventListener("click", () => {
    if (!navigator.geolocation) {
      alert("Geolocation not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setCenter(loc);
      marker.setPosition(loc);
      window.currentLocation = loc;
      map.setZoom(16);
    }, err => {
      console.warn(err);
      alert("Unable to get your location. Please allow location access.");
    }, { timeout: 8000 });
  });
}
