$(document).ready(function () {
    /**
     * Helper to show toast using the custom toastr plugin
     */
    function showToast(title, message, type = "info") {
        if ($.toastr && typeof $.toastr[type] === 'function') {
            $.toastr[type](message, title);
        } else {
            console.error("Toastr helper failed:", {title, message, type});
            // Fallback to simple alert if toastr fails
            alert(title + ": " + message);
        }
    }


    // =====================================================
    // LOGIN MODAL (MOBILE + PASSWORD) + AUTH CHECK
    // =====================================================
    // =============================
    // CHECK LOGIN STATUS ON LOAD
    // ==============================
    (function checkLoginStatus() {
        const token = localStorage.getItem("customer_token");
        const userData = localStorage.getItem("customer_data");

        if (!token || !userData) {
            $("#openLogin").show();
            $("#userAvatar").hide();
            return;
        }
        const user = JSON.parse(userData);
        // Hide login button
        $("#openLogin").hide();
        // Show avatar
        $("#userAvatar").removeClass("hidden").show();
        // Profile image logic
        let profileImage = user.profile_photo;
        if (!profileImage) {
            profileImage = "/static/images/default-avatar.jpg";
        }
        $("#profileImage").attr("src", profileImage);
    })();
    // ==============================
    // OPEN LOGIN MODAL (ONLY IF NOT LOGGED IN)
    // ==============================
    $("#openLogin").on("click", function () {
        const token = localStorage.getItem("customer_token");
        if (token) return; // already logged in

        $("#loginModal").removeClass("hidden");
    });
    // ==============================
    // CLOSE LOGIN MODAL
    // ==============================
    $("#closeLogin, #loginModal .absolute.inset-0").on("click", function () {
        $("#loginModal").addClass("hidden");
    });
    // Prevent modal close when clicking inside
    $(".relative.bg-white").on("click", function (e) {
        e.stopPropagation();
    });
    // ==============================
    // LOGIN BUTTON CLICK
    // ==============================
    $("#loginBtn").on("click", function () {
        let mobile = $("#mobileInput").val().trim();
        let password = $("#passwordInput").val().trim();
        if (mobile.length !== 10) {
            $.toastr.error("Enter a valid 10-digit mobile number");
            return;
        }
        if (password.length < 6) {
            $.toastr.error("Password must be at least 6 characters");
            return;
        }
        $.ajax({
            url: "/login", // Flask route
            type: "POST",
            contentType: "application/json",
            data: JSON.stringify({
                mobile: mobile,
                password: password
            }),
            success: function (res) {
                if (res.status !== 1) {
                    $.toastr.error(res.message || "Login failed");
                    return;
                }
                // ✅ Store token & user data
                localStorage.setItem("customer_token", res.token);
                localStorage.setItem("customer_data", JSON.stringify(res.data));
                $.toastr.success(res.message || "Login successful 🎉");
                $("#loginModal").addClass("hidden");
                setTimeout(() => {
                    location.reload();
                }, 800);
            },
            error: function () {
                $.toastr.error("Server error. Please try again.");
            }
        });
    });
    // ==============================
    // USER AVATAR DROPDOWN
    // ==============================
    $("#userAvatar").on("click", function (e) {
        e.stopPropagation();
        $("#userDropdown").toggleClass("hidden");
    });
    $(document).on("click", function () {
        $("#userDropdown").addClass("hidden");
    });
    // ==============================
    // LOGOUT
    // ==============================
    $("#logoutBtn").on("click", function () {
        localStorage.removeItem("customer_token");
        localStorage.removeItem("customer_data");

        $.toastr.success("Logged out successfully");

        setTimeout(() => {
            location.reload();
        }, 500);
    });

    $("#datePicker").flatpickr({
      altInput: true,
      altFormat: "d M, Y",    
      dateFormat: "Y-m-d",    
      defaultDate: "today",
      minDate: "today",
      disableMobile: "true"    
    });

  /* =====================================================
   GLOBAL MAP VARS
    ===================================================== */
    let map, directionsService, directionsRenderer;
    let pickupAutocomplete, dropAutocomplete;
    let pickupCircle = null;
    let dropCircle = null;

    /* =====================================================
       HELPERS
    ===================================================== */
    function getDistanceKm(lat1, lng1, lat2, lng2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }

    function isSameLocation(lat1, lng1, lat2, lng2) {
      if (!lat1 || !lat2) return false;
      return (
        Math.abs(lat1 - lat2) < 0.0001 &&
        Math.abs(lng1 - lng2) < 0.0001
      );
    }

    /* =====================================================
       TRIP BUTTON LOGIC
    ===================================================== */
    $(".tripBtn").on("click", function () {
      $(".tripBtn").removeClass("bg-gray-900 text-white");
      $(this).addClass("bg-gray-900 text-white");

      const tripType = $(this).data("trip");
      $("#trip_type").val(tripType);

      if (tripType === "round") {
        $("#returnBlock").removeClass("hidden");
        $("#returnLocationOption").removeClass("hidden");
      } else {
        resetReturnSection();
      }

      if (window.CAR_DATA) {
        renderFareBreakdown(window.CAR_DATA);
      }
    });
    /* =====================================================
       RETURN LOCATION RADIO
    ===================================================== */
    $("input[name='return_location_type']").on("change", function () {
      if ($(this).val() === "custom") {
        $("#customReturnLocation").removeClass("hidden");
      } else {
        // SAME AS PICKUP & DROP SELECTED
        resetReturnSection(true);
        drawRoute(); // redraw one-way / same-location logic
      }
    });

    /* =====================================================
       RESET RETURN SECTION (IMPORTANT FIX)
    ===================================================== */
    function resetReturnSection(keepTrip = false) {
      $("#customReturnLocation").addClass("hidden");

      $("#returnDate, #returnTime").val("");
      $("#return_pickup, #return_drop").val("");
      $("#return_pickup_lat, #return_pickup_lng").val("");
      $("#return_drop_lat, #return_drop_lng").val("");

      if (!keepTrip) {
        $("#returnBlock").addClass("hidden");
        $("#returnLocationOption").addClass("hidden");
        $("input[name='return_location_type'][value='same']").prop("checked", true);
      }

      $("#tripDetails").addClass("hidden").html("");

      if (pickupCircle) pickupCircle.setMap(null);
      if (dropCircle) dropCircle.setMap(null);
    }

    /* =====================================================
       MAP INIT
    ===================================================== */
    function initRouteMap() {
      map = new google.maps.Map(document.getElementById("routeMap"), {
        center: { lat: 28.6139, lng: 77.2090 },
        zoom: 11
      });

      directionsService = new google.maps.DirectionsService();
      directionsRenderer = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: false
      });
    }

    /* =====================================================
       DRAW ONE WAY (A → B) + SAME LOCATION × 2
    ===================================================== */
    function drawRoute() {

      const A_lat = parseFloat($("#pickup_lat").val());
      const A_lng = parseFloat($("#pickup_lng").val());
      const B_lat = parseFloat($("#drop_lat").val());
      const B_lng = parseFloat($("#drop_lng").val());

      if (!A_lat || !B_lat) return;

      directionsService.route({
        origin: { lat: A_lat, lng: A_lng },
        destination: { lat: B_lat, lng: B_lng },
        travelMode: google.maps.TravelMode.DRIVING
      }, function (result, status) {

        if (status !== "OK") return;

        directionsRenderer.setDirections(result);

        const oneWayKm  = result.routes[0].legs[0].distance.value / 1000;
        const totalKm   = oneWayKm * 2;

        // UI
        $("#distanceKm").text(totalKm.toFixed(2));
        $("#distance_value").val(totalKm.toFixed(2));

        // 🔥 PRICING LOGIC
        $("#range_km").val(oneWayKm.toFixed(2));      // Pickup → Drop
        $("#billable_km").val(totalKm.toFixed(2));   // A → B → A

        $("#tripDetails").removeClass("hidden").html(`
          <div class="font-semibold mb-1">Trip Distance Details</div>
          <div class="flex justify-between">
            <span>Pickup → Drop</span>
            <strong>${oneWayKm.toFixed(2)} km</strong>
          </div>
          <div class="flex justify-between">
            <span>Return (empty cab)</span>
            <strong>${oneWayKm.toFixed(2)} km</strong>
          </div>
          <hr class="my-2">
          <div class="flex justify-between font-semibold">
            <span>Total Distance</span>
            <span>${totalKm.toFixed(2)} km</span>
          </div>
        `);

        if (window.CAR_DATA) {
          renderFareBreakdown(window.CAR_DATA);
        }
      });
    }




    /* =====================================================
       DRAW FULL ROUND TRIP (A → B → C → D → A)
    ===================================================== */
    function drawFullRoundTrip() {
        
      const A_lat = parseFloat($("#pickup_lat").val());
      const A_lng = parseFloat($("#pickup_lng").val());
      const B_lat = parseFloat($("#drop_lat").val());
      const B_lng = parseFloat($("#drop_lng").val());
      const C_lat = parseFloat($("#return_pickup_lat").val());
      const C_lng = parseFloat($("#return_pickup_lng").val());
      const D_lat = parseFloat($("#return_drop_lat").val());
      const D_lng = parseFloat($("#return_drop_lng").val());
        
      if (!A_lat || !B_lat || !C_lat || !D_lat) return;
        
      directionsService.route({
        origin: { lat: A_lat, lng: A_lng },
        destination: { lat: A_lat, lng: A_lng },
        waypoints: [
          { location: { lat: B_lat, lng: B_lng }, stopover: true },
          { location: { lat: C_lat, lng: C_lng }, stopover: true },
          { location: { lat: D_lat, lng: D_lng }, stopover: true }
        ],
        travelMode: google.maps.TravelMode.DRIVING
      }, function (result, status) {
    
        if (status !== "OK") return;
    
        directionsRenderer.setDirections(result);
    
        const labels = [
          "Pickup → Drop",
          "Drop → Return Pickup",
          "Return Pickup → Return Drop",
          "Return Drop → Pickup"
        ];
    
        let totalKm = 0;
        let html = `<div class="font-semibold mb-1">Trip Distance Details</div>`;
    
        result.routes[0].legs.forEach((leg, i) => {
        
          const km = leg.distance.value / 1000;
          if (km <= 0.1) return;
        
          totalKm += km;
        
          html += `
            <div class="flex justify-between">
              <span>${labels[i]}</span>
              <strong>${km.toFixed(2)} km</strong>
            </div>
          `;
        });
    
        html += `
          <hr class="my-2">
          <div class="flex justify-between font-semibold">
            <span>Total Distance</span>
            <span>${totalKm.toFixed(2)} km</span>
          </div>
        `;
    
        // 🔥 PRICING LOGIC
        const pickupDropKm = result.routes[0].legs[0].distance.value / 1000;
    
        $("#distanceKm").text(totalKm.toFixed(2));
        $("#distance_value").val(totalKm.toFixed(2));
    
        $("#range_km").val(pickupDropKm.toFixed(2)); // range check
        $("#billable_km").val(totalKm.toFixed(2));   // full round km
    
        $("#tripDetails").removeClass("hidden").html(html);
    
        if (window.CAR_DATA) {
          renderFareBreakdown(window.CAR_DATA);
        }
      });
    }


    /* =====================================================
       AUTOCOMPLETE INIT
    ===================================================== */
    function initAutocomplete() {

      pickupAutocomplete = new google.maps.places.Autocomplete(
        document.getElementById("pickup"),
        { componentRestrictions: { country: "in" } }
      );
      pickupAutocomplete.addListener("place_changed", function () {
        const p = pickupAutocomplete.getPlace();
        if (!p.geometry) return;
        $("#pickup_lat").val(p.geometry.location.lat());
        $("#pickup_lng").val(p.geometry.location.lng());
        map.setCenter(p.geometry.location);
        drawRoute();
      });

      dropAutocomplete = new google.maps.places.Autocomplete(
        document.getElementById("drop"),
        { componentRestrictions: { country: "in" } }
      );
      dropAutocomplete.addListener("place_changed", function () {
        const p = dropAutocomplete.getPlace();
        if (!p.geometry) return;
        $("#drop_lat").val(p.geometry.location.lat());
        $("#drop_lng").val(p.geometry.location.lng());
        drawRoute();
      });

      const returnPickupAuto = new google.maps.places.Autocomplete(
        document.getElementById("return_pickup"),
        { componentRestrictions: { country: "in" } }
      );
      returnPickupAuto.addListener("place_changed", function () {
        const p = returnPickupAuto.getPlace();
        if (!p.geometry) return;

        const dLat = parseFloat($("#drop_lat").val());
        const dLng = parseFloat($("#drop_lng").val());
        const rLat = p.geometry.location.lat();
        const rLng = p.geometry.location.lng();

        if (getDistanceKm(dLat, dLng, rLat, rLng) > 5) {
          $.toastr.error("Return pickup must be within 5 km from drop");
          $("#return_pickup").val("");
          return;
        }

        $("#return_pickup_lat").val(rLat);
        $("#return_pickup_lng").val(rLng);
      });

      const returnDropAuto = new google.maps.places.Autocomplete(
        document.getElementById("return_drop"),
        { componentRestrictions: { country: "in" } }
      );
      returnDropAuto.addListener("place_changed", function () {
        const p = returnDropAuto.getPlace();
        if (!p.geometry) return;

        const A_lat = parseFloat($("#pickup_lat").val());
        const A_lng = parseFloat($("#pickup_lng").val());
        const rLat = p.geometry.location.lat();
        const rLng = p.geometry.location.lng();

        if (getDistanceKm(A_lat, A_lng, rLat, rLng) > 10) {
          $.toastr.error("Return drop must be within 10 km from pickup");
          $("#return_drop").val("");
          return;
        }

        $("#return_drop_lat").val(rLat);
        $("#return_drop_lng").val(rLng);

        drawFullRoundTrip();
      });
    }

    /* =====================================================
       INIT
    ===================================================== */
    setTimeout(() => {
      initRouteMap();
      initAutocomplete();
    }, 800);

    /* =====================================================
       CURRENT LOCATION (PICKUP ONLY)
    ===================================================== */
    $("#useCurrentLocation").on("click", function () {
      if (!navigator.geolocation) {
        $.toastr.error("Geolocation not supported");
        return;
      }

      navigator.geolocation.getCurrentPosition(function (position) {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        $("#pickup_lat").val(lat);
        $("#pickup_lng").val(lng);

        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat, lng } }, function (results, status) {
          if (status === "OK" && results[0]) {
            $("#pickup").val(results[0].formatted_address);
            map.setCenter({ lat, lng });
            drawRoute();
          }
        });
      });
    });

    /* =====================================================   
    // FARE BREAKDOWN RENDER
    ===================================================== */         
 function renderFareBreakdown(carData) {
  if (!carData) return;

  const tripType = $("#trip_type").val();
  const apiTripType = tripType === "oneway" ? "one_way" : "round_trip";
  const billableKm = parseFloat($("#billable_km").val() || 0);

  if (billableKm <= 0) {
      $("#fareBreakdown").html("");
      $("#totalFareBottom").text("0");
      $("#totalFareSticky").text("0");
      $("#totalFare").text("0");
      return;
  }

  // Show a loading state
  $("#fareBreakdown").html('<div class="text-gray-500 text-center py-2"><i class="fas fa-spinner fa-spin mr-2"></i> Calculating fare...</div>');

  const payload = {
    car_id: carData.id,
    distance_km: billableKm,
    trip_type: apiTripType,
    stay_duration: "short", // Hardcoded per user prompt
    waiting_minutes: 0,
    is_ac: carData.is_ac == 1 || carData.is_ac === true
  };

  $.ajax({
    url: "/calculate-charges",
    type: "POST",
    contentType: "application/json",
    data: JSON.stringify(payload),
    success: function (res) {
      if (res && res.success && res.data) {
        const data = res.data;
        let html = "";
        
        if (data.charges_breakdown && data.charges_breakdown.length > 0) {
          data.charges_breakdown.forEach(charge => {
            let label = charge.type || charge.charge_type;
            
            // Format distance & rate if not already in label
            if (charge.distance && charge.rate && !label.includes('km')) {
                label += ` (${charge.distance} km × ${data.currency || '₹'}${charge.rate})`;
            }
            
            html += `
              <div class="flex justify-between">
                <span>${label}</span>
                <span>${data.currency || '₹'} ${Math.round(charge.amount)}</span>
              </div>`;
          });
        } else {
            html = '<div class="text-gray-500">No charges applied.</div>';
        }

        $("#fareBreakdown").html(html);
        
        const total = Math.round(data.total_amount || 0);
        $("#totalFareBottom").text(total);
        $("#totalFareSticky").text(total);
        $("#totalFare").text(total);
      } else {
        $("#fareBreakdown").html('<div class="text-red-500 text-sm">Failed to calculate fare properly.</div>');
      }
    },
    error: function (xhr) {
      console.error("Fare calculation error:", xhr.responseText);
      const err = xhr.responseJSON || {};
      const msg = err.error || err.debug || err.message || "Error calculating fare. Please check connection.";
      $("#fareBreakdown").html(`<div class="text-red-500 text-sm">${msg}</div>`);
      showToast("Calculation Error", msg, "error");
    }
  });
}


    // =====================================================
    // DATE PICKER INIT
    // =====================================================
    flatpickr("#pickupDate", {
      altInput: true,
      altFormat: "d M, Y",
      dateFormat: "Y-m-d",

      defaultDate: "today",
      minDate: "today",
      disableMobile: true
    });
    //====================================================
    // TIME PICKER INIT
    // =====================================================
    flatpickr("#pickupTime", {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      time_24hr: true,
      minuteIncrement: 10,
      minTime: "00:00",
      maxTime: "23:50",
      disableMobile: true
    });
    // =====================================================
    // RETURN DATE & TIME PICKER INIT
    // ====================================================

    flatpickr("#returnDate", {
      altInput: true,
      altFormat: "d M, Y",
      dateFormat: "Y-m-d",
      minDate: "today",
      disableMobile: true
    });
    //====================================================
    // RETURN TIME PICKER INIT
    // =====================================================
    flatpickr("#returnTime", {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      time_24hr: true,
      minuteIncrement: 10,
      minTime: "00:00",
      maxTime: "23:50",
      disableMobile: true
    });
    // =====================================================
    // PICKUP & RETURN DATE LINKED LOGIC
    // =====================================================

    flatpickr("#pickupDate", {
      altInput: true,
      altFormat: "d M, Y",
      dateFormat: "Y-m-d",
      defaultDate: "today",
      minDate: "today",
      disableMobile: true,
      onChange: function(selectedDates) {
        if (selectedDates.length) {
          returnDatePicker.set("minDate", selectedDates[0]);
        }
      }
    });
    //====================================================
    // RETURN DATE PICKER INSTANCE
    // =====================================================
    const returnDatePicker = flatpickr("#returnDate", {
      altInput: true,
      altFormat: "d M, Y",
      dateFormat: "Y-m-d",
      minDate: "today",
      disableMobile: true
    });

    // =====================================================
    // TOGGLE
    // =====================================================

    // var options = {
    //   strings: ["FORCE", "TAXI", "CAR", "CABS", "BUS", "TEMPO"],
    //   typeSpeed: 100,
    //   backSpeed: 50,
    //   backDelay: 2000,
    //   startDelay: 500,
    //   loop: true
    // };
    // var typed = new Typed("#typed", options);

    $('.faq-toggle').on('click', function () {
      const $button = $(this);
      const $content = $button.next('.faq-content');
      const $icon = $button.find('svg');
      $('.faq-content').not($content).slideUp();
      $('.faq-toggle svg').not($icon).removeClass('rotate-180');
      $content.slideToggle();
      $icon.toggleClass('rotate-180');
    });
    /**
     * =============================================================================
     * TOAST NOTIFICATION PLUGIN
     * A customizable toast notification system with animations and themes
     * =============================================================================
     */
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
    function enforceLightMode() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            // Force light mode
            document.documentElement.style.backgroundColor = "#ffffff"; // White background
            document.documentElement.style.color = "#000000"; // Black text
            document.documentElement.setAttribute("data-theme", "light"); // Optional for CSS usage
        }
    }

    // Run on page load
    enforceLightMode();

    // Listen for changes (if user switches theme)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', enforceLightMode);

    $.toastr = (function () {
        // -------------------------------------------------------------------------
        // DEFAULT CONFIGURATION
        // -------------------------------------------------------------------------
        const defaults = {
            position: 'top-right',
            duration: 5000,
            closeButton: true,
            progressBar: true,
            escapeHtml: true,
            showDuration: 500,    // Duration for show animation in ms
            hideDuration: 500,    // Duration for hide animation in ms
            animation: 'fade', // Animation type: 'fade', 'slide', 'bounce'
            easing: 'ease'  // CSS easing function for animations
        };

        // Container registry for different positions
        const containers = {};

        // -------------------------------------------------------------------------
        // CONTAINER MANAGEMENT
        // -------------------------------------------------------------------------

        /**
         * Creates a container for toasts at a specific position
         * @param {string} position Position identifier (e.g., 'top-right')
         * @return {jQuery} Container element
         */
        function createContainer(position) {
            const container = $('<div>').addClass(getPositionClass(position));
            $('body').append(container);
            return container;
        }

        /**
         * Get position-specific CSS classes
         * @param {string} position Position identifier
         * @return {string} CSS classes for the specified position
         */
        function getPositionClass(position) {
            const positionClasses = {
                'top-right': 'fixed top-4 right-4 z-50 flex flex-col gap-4 max-w-xs sm:max-w-sm',
                'top-left': 'fixed top-4 left-4 z-50 flex flex-col gap-4 max-w-xs sm:max-w-sm',
                'bottom-right': 'fixed bottom-4 right-4 z-50 flex flex-col gap-4 max-w-xs sm:max-w-sm',
                'bottom-left': 'fixed bottom-4 left-4 z-50 flex flex-col gap-4 max-w-xs sm:max-w-sm',
                'top-center': 'fixed top-4 left-1/2 transform -translate-x-1/2 z-50 flex flex-col gap-4 max-w-xs sm:max-w-sm',
                'bottom-center': 'fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 flex flex-col gap-4 max-w-xs sm:max-w-sm'
            };
            return positionClasses[position] || positionClasses['top-right'];
        }

        // -------------------------------------------------------------------------
        // TOAST APPEARANCE HELPERS
        // -------------------------------------------------------------------------

        /**
         * Get CSS classes for different toast types
         * @param {string} type Toast type ('success', 'error', 'warning', 'info')
         * @return {string} CSS classes for the specified type
         */
        function getTypeClass(type) {
            const typeClasses = {
                'success': 'bg-green-100 border-l-4 border-green-500 text-green-800',
                'error': 'bg-red-100 border-l-4 border-red-500 text-red-800',
                'warning': 'bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800',
                'info': 'bg-blue-100 border-l-4 border-blue-500 text-blue-800'
            };
            return typeClasses[type] || typeClasses['info'];
        }

        /**
         * Get SVG icon for toast type
         * @param {string} type Toast type
         * @return {string} SVG markup for the icon
         */
        function getIconSVG(type) {
            const icons = {
                'success': `<svg class="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>`,
                'error': `<svg class="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>`,
                'warning': `<svg class="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>`,
                'info': `<svg class="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>`
            };
            return icons[type] || icons['info'];
        }

        // -------------------------------------------------------------------------
        // ANIMATION FUNCTIONS
        // -------------------------------------------------------------------------

        /**
         * Apply show animation to toast element
         * @param {jQuery} toast Toast element
         * @param {Object} options Animation options
         */
        function applyShowAnimation(toast, options) {
            const position = options.position;
            const isTop = position.includes('top');
            const transition = `all ${options.showDuration}ms ${options.easing}`;
            switch (options.animation) {
                case 'slide':
                    // Determine slide-in direction based on position
                    if (isTop) {
                        toast.css({
                            'transform': 'translateY(-100%)',
                            'opacity': '0',
                            'transition': transition
                        });
                        setTimeout(() => {
                            toast.css({
                                'transform': 'translateY(0)',
                                'opacity': '1'
                            });
                        }, 10);
                    } else {
                        toast.css({
                            'transform': 'translateY(100%)',
                            'opacity': '0',
                            'transition': transition
                        });
                        setTimeout(() => {
                            toast.css({
                                'transform': 'translateY(0)',
                                'opacity': '1'
                            });
                        }, 10);
                    }
                    break;
                case 'bounce':
                    // Determine bounce-in direction based on position
                    if (isTop) {
                        toast.css({
                            'transform': 'translateY(-120%)',
                            'opacity': '0',
                            'transition': transition
                        });
                        setTimeout(() => {
                            toast.css({
                                'transform': 'translateY(0)',
                                'opacity': '1'
                            });
                            // Add slight bounce effect
                            setTimeout(() => {
                                toast.css({
                                    'transform': 'translateY(-10%)',
                                    'transition': `all 200ms ${options.easing}`
                                });
                                setTimeout(() => {
                                    toast.css({
                                        'transform': 'translateY(0)',
                                        'transition': `all 200ms ${options.easing}`
                                    });
                                }, 200);
                            }, options.showDuration);
                        }, 10);
                    } else {
                        toast.css({
                            'transform': 'translateY(120%)',
                            'opacity': '0',
                            'transition': transition
                        });
                        setTimeout(() => {
                            toast.css({
                                'transform': 'translateY(0)',
                                'opacity': '1'
                            });
                            // Add slight bounce effect
                            setTimeout(() => {
                                toast.css({
                                    'transform': 'translateY(10%)',
                                    'transition': `all 200ms ${options.easing}`
                                });
                                setTimeout(() => {
                                    toast.css({
                                        'transform': 'translateY(0)',
                                        'transition': `all 200ms ${options.easing}`
                                    });
                                }, 200);
                            }, options.showDuration);
                        }, 10);
                    }
                    break;
                case 'fade':
                default:
                    // Simple fade-in
                    toast.css({
                        'opacity': '0',
                        'transition': transition
                    });
                    setTimeout(() => {
                        toast.css('opacity', '1');
                    }, 10);
                    break;
            }
        }

        /**
         * Apply hide animation to toast element
         * @param {jQuery} toast Toast element
         * @param {Object} options Animation options
         */
        function applyHideAnimation(toast, options) {
            const position = options.position;
            const isTop = position.includes('top');
            const transition = `all ${options.hideDuration}ms ${options.easing}`;
            switch (options.animation) {
                case 'slide':
                    if (isTop) {
                        toast.css({
                            'transform': 'translateY(-100%)',
                            'opacity': '0',
                            'transition': transition
                        });
                    } else {
                        toast.css({
                            'transform': 'translateY(100%)',
                            'opacity': '0',
                            'transition': transition
                        });
                    }
                    break;
                case 'bounce':
                    toast.css({
                        'transform': 'scale(0.8)',
                        'opacity': '0',
                        'transition': transition
                    });
                    break;
                case 'fade':
                default:
                    toast.css({
                        'opacity': '0',
                        'transition': transition
                    });
                    break;
            }
        }

        // -------------------------------------------------------------------------
        // TOAST CREATION AND MANAGEMENT
        // -------------------------------------------------------------------------

        /**
         * Create a toast element
         * @param {string} type Toast type
         * @param {string} message Toast message
         * @param {string} title Optional toast title
         * @param {Object} options Toast configuration options
         * @return {jQuery} Created toast element
         */
        function createToast(type, message, title, options) {
            // Create base toast element
            const toastElement = $('<div>').addClass(`w-full rounded-lg shadow-lg overflow-hidden ${getTypeClass(type)}`);
            // Add pulse animation to icon for added emphasis
            const iconAnimation = `
                @keyframes pulse-${type} {
                    0% { transform: scale(1); }
                    50% { transform: scale(1.1); }
                    100% { transform: scale(1); }
                }
            `;

            // Toast inner content with improved layout
            let contentHtml = `
                <style>${iconAnimation}</style>
                <div class="p-4">
                    <div class="flex items-start">
                        <div class="flex-shrink-0 mt-0.5">
                            <div style="animation: pulse-${type} 2s infinite">${getIconSVG(type)}</div>
                        </div>
                        <div class="ml-3 flex-1 mr-2">
            `;
            // Add title if provided with better styling
            if (title) {
                contentHtml += `<p class="text-sm font-semibold break-words">
                    ${options.escapeHtml ? $('<div>').text(title).html() : title}
                </p>`;
            }
            // Add message with better spacing and text wrapping
            contentHtml += `
                <p class="${title ? 'mt-1' : ''} text-sm break-words">
                    ${options.escapeHtml ? $('<div>').text(message).html() : message}
                </p>
            `;
            contentHtml += `</div>`;
            // Add close button if enabled with better positioning
            if (options.closeButton) {
                contentHtml += `
                    <div class="flex-shrink-0 flex">
                        <button class="close-toast inline-flex text-gray-400 hover:text-gray-500 focus:outline-none transition-all duration-300 transform hover:rotate-90">
                            <svg class="h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                            </svg>
                        </button>
                    </div>
                `;
            }
            contentHtml += `</div></div>`;
            // Add animated progress bar if enabled
            if (options.progressBar) {
                contentHtml += `
                    <div class="w-full bg-gray-100 h-1 progress-bar-container">
                        <div class="h-1 progress-bar bg-${type === 'info' ? 'blue' : type === 'success' ? 'green' : type === 'warning' ? 'yellow' : 'red'}-500" style="width: 100%; transition: width linear;"></div>
                    </div>
                `;
            }
            toastElement.html(contentHtml);
            return toastElement;
        }

        /**
         * Add toast to container with animations
         * @param {jQuery} toast Toast element
         * @param {string} position Position identifier
         * @param {Object} options Toast configuration options
         */
        function addToast(toast, position, options) {
            // Get or create container for the position
            if (!containers[position]) {
                containers[position] = createContainer(position);
            }
            const container = containers[position];
            // Add toast to container based on position
            const isTopPosition = position.includes('top');
            if (isTopPosition) {
                container.prepend(toast);
            } else {
                container.append(toast);
            }
            // Apply show animation
            applyShowAnimation(toast, options);
        }

        /**
         * Remove toast with animations
         * @param {jQuery} toast Toast element
         * @param {Object} options Toast configuration options
         */
        function removeToast(toast, options = {}) {
            // Default to standard hide duration if not specified
            const hideDuration = options.hideDuration || defaults.hideDuration;
            // Skip if toast is already being removed
            if (toast.data('removing')) return;
            // Mark as removing to prevent duplicate removal
            toast.data('removing', true);
            // Stop any progress update
            const progressInterval = toast.data('progressInterval');
            if (progressInterval) {
                clearInterval(progressInterval);
            }
            // Apply hide animation
            applyHideAnimation(toast, options);
            // Remove element after animation completes
            setTimeout(() => {
                toast.remove();
                // Clean up empty containers
                $.each(containers, (position, container) => {
                    if (container.children().length === 0) {
                        container.remove();
                        delete containers[position];
                    }
                });
            }, hideDuration);
        }

        /**
         * Update progress bar width with animation
         * @param {jQuery} toast Toast element
         * @param {number} progress Progress percentage (0-100)
         */
        function updateProgressBar(toast, progress) {
            const progressBar = toast.find('.progress-bar');
            if (progressBar.length) {
                progressBar.css({
                    'width': progress + '%',
                    'transition': 'width 100ms linear'
                });
            }
        }

        /**
         * Pause toast dismissal
         * @param {jQuery} toast Toast element
         */
        function pauseToast(toast) {
            // If toast is being removed or already paused, do nothing
            if (toast.data('removing') || toast.data('paused')) return;
            // Mark toast as paused
            toast.data('paused', true);
            // Clear the auto dismiss timeout
            const timeout = toast.data('autoDismissTimeout');
            if (timeout) {
                clearTimeout(timeout);
                // Store the remaining time
                const elapsed = Date.now() - toast.data('startTime');
                const remaining = toast.data('duration') - elapsed;
                toast.data('remainingTime', remaining > 0 ? remaining : 0);
            }
            // Pause progress interval
            const progressInterval = toast.data('progressInterval');
            if (progressInterval) {
                clearInterval(progressInterval);
                // Store current progress
                toast.data('currentProgress', toast.find('.progress-bar').width() / toast.find('.progress-bar-container').width() * 100);
            }
            // Add a subtle scale effect to indicate toast is paused
            toast.css({
                'transform': 'scale(1.02)',
                'transition': 'transform 300ms ease',
                'box-shadow': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)'
            });
        }

        /**
         * Resume toast dismissal
         * @param {jQuery} toast Toast element
         * @param {Object} options Toast configuration options
         */
        function resumeToast(toast, options) {
            // If toast is being removed or not paused, do nothing
            if (toast.data('removing') || !toast.data('paused')) return;

            // Reset the subtle scale effect
            toast.css({
                'transform': 'scale(1)',
                'transition': 'transform 300ms ease',
                'box-shadow': ''
            });

            // Get remaining time or use default duration
            const remaining = toast.data('remainingTime') || options.duration;

            // Resume auto dismiss if there's remaining time
            if (remaining > 0) {
                toast.data('autoDismissTimeout', setTimeout(() => {
                    if (toast.parent().length && !toast.data('removing') && !toast.data('paused')) {
                        removeToast(toast, options);
                    }
                }, remaining));

                // Update start time
                toast.data('startTime', Date.now());
                toast.data('duration', remaining);
            }

            // Resume progress bar if enabled
            if (options.progressBar) {
                const currentProgress = toast.data('currentProgress') || 100;
                const progressSteps = remaining / 100; // Update every ~100ms
                let progressValue = currentProgress;

                const progressInterval = setInterval(() => {
                    progressValue = Math.max(0, progressValue - (100 / (remaining / 100)));

                    if (toast.parent().length && !toast.data('removing')) {
                        updateProgressBar(toast, progressValue);
                    }

                    if (progressValue <= 0) {
                        clearInterval(progressInterval);
                    }
                }, 100);

                toast.data('progressInterval', progressInterval);
            }

            // Mark toast as not paused
            toast.data('paused', false);
        }

        /**
         * Add clickable ripple effect to toast
         * @param {jQuery} toast Toast element
         */
        function addRippleEffect(toast) {
            toast.on('mousedown', function (e) {
                if ($(e.target).hasClass('close-toast') || $(e.target).parents('.close-toast').length) {
                    return; // Skip ripple on close button
                }

                const ripple = $('<span>');
                const size = Math.max(toast.width(), toast.height());

                ripple.css({
                    position: 'absolute',
                    top: e.pageY - toast.offset().top - size / 2,
                    left: e.pageX - toast.offset().left - size / 2,
                    width: size + 'px',
                    height: size + 'px',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(255, 255, 255, 0.3)',
                    transform: 'scale(0)',
                    transition: 'transform 600ms linear, opacity 600ms linear',
                    opacity: 1,
                    pointerEvents: 'none'
                });

                toast.append(ripple);

                setTimeout(() => {
                    ripple.css({
                        'transform': 'scale(2)',
                        'opacity': '0'
                    });

                    setTimeout(() => {
                        ripple.remove();
                    }, 600);
                }, 10);
            });

            // Ensure proper relative positioning for the ripple
            toast.css('position', 'relative');
            toast.css('overflow', 'hidden');
        }

        /**
         * Main toast creation function
         * @param {string} type Toast type
         * @param {string} message Toast message
         * @param {string} title Optional toast title
         * @param {Object} userOptions User configuration options
         * @return {jQuery} Created toast element
         */
        function show(type, message, title, userOptions = {}) {
            // Merge user options with defaults
            const options = $.extend({}, defaults, userOptions);

            // Create toast element
            const toast = createToast(type, message, title, options);

            // Add click event to close button
            toast.find('.close-toast').on('click', function () {
                removeToast(toast, options);
            });

            // Add hover events to pause/resume toast
            toast.on('mouseenter', function () {
                pauseToast(toast);
            }).on('mouseleave', function () {
                resumeToast(toast, options);
            });

            // Add ripple effect on click
            addRippleEffect(toast);

            // Add toast to container with animations
            addToast(toast, options.position, options);

            // Store the start time
            toast.data('startTime', Date.now());
            toast.data('duration', options.duration);

            // Handle progress bar and auto dismiss
            if (options.duration > 0) {
                // For progressBar, update at intervals
                if (options.progressBar) {
                    const intervalDuration = 100; // Update progress every 100ms
                    const steps = options.duration / intervalDuration;
                    let currentStep = 0;

                    const progressInterval = setInterval(() => {
                        // Skip updates if toast is paused
                        if (toast.data('paused')) return;

                        currentStep++;
                        const progress = 100 - ((currentStep / steps) * 100);

                        if (toast.parent().length && !toast.data('removing')) {
                            updateProgressBar(toast, progress);
                        }

                        if (currentStep >= steps) {
                            clearInterval(progressInterval);
                        }
                    }, intervalDuration);

                    toast.data('progressInterval', progressInterval);
                }

                // Auto dismiss after duration
                toast.data('autoDismissTimeout', setTimeout(() => {
                    if (toast.parent().length && !toast.data('removing') && !toast.data('paused')) {
                        removeToast(toast, options);
                    }
                }, options.duration));
            }

            // Return toast element for chaining
            return toast;
        }

        // -------------------------------------------------------------------------
        // PUBLIC API
        // -------------------------------------------------------------------------
        return {
            /**
             * Show success toast notification
             * @param {string} message Toast message
             * @param {string} title Optional toast title
             * @param {Object} options Toast configuration options
             * @return {jQuery} Created toast element
             */
            success: (message, title, options) => show('success', message, title, options),

            /**
             * Show error toast notification
             * @param {string} message Toast message
             * @param {string} title Optional toast title
             * @param {Object} options Toast configuration options
             * @return {jQuery} Created toast element
             */
            error: (message, title, options) => show('error', message, title, options),

            /**
             * Show warning toast notification
             * @param {string} message Toast message
             * @param {string} title Optional toast title
             * @param {Object} options Toast configuration options
             * @return {jQuery} Created toast element
             */
            warning: (message, title, options) => show('warning', message, title, options),

            /**
             * Show info toast notification
             * @param {string} message Toast message
             * @param {string} title Optional toast title
             * @param {Object} options Toast configuration options
             * @return {jQuery} Created toast element
             */
            info: (message, title, options) => show('info', message, title, options),

            /**
             * Set default options for all toasts
             * @param {Object} options Default configuration options
             */
            setDefaults: (options) => {
                $.extend(defaults, options);
            },

            /**
             * Clear all active toasts
             */
            clear: () => {
                $.each(containers, (position, container) => {
                    container.find('div').each(function () {
                        const toast = $(this);

                        // Clear any pending auto-dismiss timeout
                        const timeout = toast.data('autoDismissTimeout');
                        if (timeout) {
                            clearTimeout(timeout);
                        }

                        // Clear any progress interval
                        const interval = toast.data('progressInterval');
                        if (interval) {
                            clearInterval(interval);
                        }

                        removeToast(toast, defaults);
                    });
                });
            }
        };
    })();

    // Add as jQuery plugin
    $.fn.toastr = function (options) {
        return this;
    };

    // ==========================================
    // UTILITY FUNCTIONS
    // ==========================================

    /**
     * Helper function to update or add query string parameter
     */
    function updateQueryStringParameter(uri, key, value) {
        var re = new RegExp("([?&])" + key + "=.*?(&|$)", "i");
        var separator = uri.indexOf('?') !== -1 ? "&" : "?";
        if (uri.match(re)) {
            return uri.replace(re, '$1' + key + "=" + value + '$2');
        } else {
            return uri + separator + key + "=" + value;
        }
    }

    
    // User dropdown toggle
    $("#user-menu-button").click(function () {
        if ($("#user-dropdown").hasClass("hidden")) {
            $("#user-dropdown").removeClass("hidden");
            setTimeout(function () {
                $("#user-dropdown").removeClass("opacity-0 scale-95").addClass("opacity-100 scale-100");
            }, 10);
        } else {
            $("#user-dropdown").removeClass("opacity-100 scale-100").addClass("opacity-0 scale-95");
            setTimeout(function () {
                $("#user-dropdown").addClass("hidden");
            }, 200);
        }
    });

    // Close user dropdown when clicking outside
    $(document).click(function (e) {
        if (!$(e.target).closest('#user-menu-button, #user-dropdown').length && !$("#user-dropdown").hasClass("hidden")) {
            $("#user-dropdown").removeClass("opacity-100 scale-100").addClass("opacity-0 scale-95");
            setTimeout(function () {
                $("#user-dropdown").addClass("hidden");
            }, 200);
        }
    });


    $('#notification-button').click(function () {
        if ($('#notification-dropdown').hasClass('hidden')) {
            $('#notification-dropdown').removeClass('hidden');
            setTimeout(function () {
                $('#notification-dropdown').removeClass('opacity-0 scale-95').addClass('opacity-100 scale-100');
            }, 10);
        } else {
            $('#notification-dropdown').removeClass('opacity-100 scale-100').addClass('opacity-0 scale-95');
            setTimeout(function () {
                $('#notification-dropdown').addClass('hidden');
            }, 200);
        }
    });

    // Close Notification Dropdown 
    $(document).click(function (e) {
        if (!$(e.target).closest('#notification-button, #notification-dropdown').length && !$('#notification-dropdown').hasClass('hidden')) {
            $('#notification-dropdown').removeClass('opacity-100 scale-100').addClass('opacity-0 scale-95');
            setTimeout(function () {
                $('#notification-dropdown').addClass('hidden');
            }, 200);
        }
    });

    // =====================================================
    // PLACE BOOKING (SUBMIT FORM)
    // =====================================================
    $("#bookingForm").on("submit", function (e) {
        e.preventDefault();
        
        if (!window.CAR_DATA) {
            showToast("Error", "Car data is missing. Please refresh the page.", "error");
            return;
        }

        const btn = $(this).find('button[type="submit"]');
        const originalText = btn.text();
        
        // Basic Validation
        const pickup = $("#pickup").val();
        const drop = $("#drop").val();
        const custName = $("#custName").val();
        const custPhone = $("#custPhone").val();

        if (!pickup || !drop) {
            showToast("Warning", "Please select pickup and drop locations on the map.", "warning");
            return;
        }
        if (!custName || !custPhone) {
            showToast("Warning", "Please enter your name and mobile number.", "warning");
            return;
        }

        btn.html('<i class="fas fa-spinner fa-spin mr-2"></i> Booking...').prop('disabled', true);

        const tripType = $("#trip_type").val() === "oneway" ? "one_way" : "round_trip";
        const oneWayKm = parseFloat($("#range_km").val() || 0);
        
        const payload = {
            car_id: window.CAR_DATA.id,
            trip_type: tripType,
            stay_duration: "short",
            is_ac: window.CAR_DATA.is_ac == 1,
            
            // Pickup details
            pickup_address: pickup,
            pickup_lat: $("#pickup_lat").val(),
            pickup_lng: $("#pickup_lng").val(),
            
            // Drop details
            drop_address: drop,
            drop_lat: $("#drop_lat").val(),
            drop_lng: $("#drop_lng").val(),
            
            // Return details (only if round_trip)
            return_pickup_address: tripType === "round_trip" ? $("#return_pickup").val() : null,
            return_pickup_lat: tripType === "round_trip" ? $("#return_pickup_lat").val() : null,
            return_pickup_lng: tripType === "round_trip" ? $("#return_pickup_lng").val() : null,
            return_drop_address: tripType === "round_trip" ? $("#return_drop").val() : null,
            return_drop_lat: tripType === "round_trip" ? $("#return_drop_lat").val() : null,
            return_drop_lng: tripType === "round_trip" ? $("#return_drop_lng").val() : null,
            
            // Distance
            distance_km: oneWayKm,
            return_km: tripType === "round_trip" ? parseFloat($("#distance_value").val() || 0) - oneWayKm : 0,
            
            // Schedule
            pickup_date: $("#pickupDate").val(),
            pickup_time: $("#pickupTime").val(),
            return_date: tripType === "round_trip" ? $("#returnDate").val() : null,
            return_time: tripType === "round_trip" ? $("#returnTime").val() : null,
            
            // Passengers
            passengers: $("#pax").val(),
            bags: $("#bags").val(),
            notes_for_driver: $("#notes").val(),
            
            // Customer
            customer_name: custName,
            customer_mobile: custPhone,
            
            // Extras
            coupon_code: $("#coupon").val(),
            waiting_minutes: 0,
            estimated_toll: parseFloat($("#toll_value").val() || 0)
        };

        const token = localStorage.getItem("customer_token");
        const headers = {};
        if (token) {
            headers["Authorization"] = "Bearer " + token;
        }

        $.ajax({
            url: "/place-order",
            type: "POST",
            headers: headers,
            contentType: "application/json",
            data: JSON.stringify(payload),
            success: function (res) {
                if (res.status === 1) {
                    showToast("Success", "Booking confirmed! Redirecting...", "success");
                    // Redirect to a success page or home after 2 seconds
                    setTimeout(() => {
                        window.location.href = "/";
                    }, 2000);
                } else {
                    showToast("Error", res.message || "Failed to place order.", "error");
                    btn.text(originalText).prop('disabled', false);
                }
            },
            error: function (xhr) {
                console.error("Booking failed:", xhr.responseText);
                const err = xhr.responseJSON || {};
                const msg = err.error || err.debug || err.message || "Something went wrong while placing the order.";
                showToast("Error", msg, "error");
                btn.text(originalText).prop('disabled', false);
            }
        });
    });

});