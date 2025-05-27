document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("bra-size-form").addEventListener("submit", function(event) {
    event.preventDefault();
    const underbust = parseFloat(document.getElementById("underbust").value);
    const overbust = parseFloat(document.getElementById("overbust").value);
    const braSize = calculateBraSize(underbust, overbust);
    const braCupSize = braSize.cup;
    const braBandSize = braSize.band;
    const braLocations = braSize.locations;
    const resultText = `Your Bra Size is: ${braBandSize}${braCupSize}`;
    document.getElementById("bra-size-result").innerHTML = resultText;
  });
});

function calculateBraSize(underbust, overbust) {
  // Calculate the difference between overbust and underbust measurements
  const difference = overbust - underbust;

  // Determine the cup size based on the difference
  let cupSize = "";
  if (difference <= 1) {
    cupSize = "AA";
  } else if (difference === 1) {
    cupSize = "A";
  } else {
    // For differences larger than 1 inch, use letters A, B, C, D, etc.
    const cupLetters = ["A", "B", "C", "D", "DD/E", "DDD/F", "G", "H", "I", "J", "K", "L", "M"];
    cupSize = cupLetters[difference - 2];
  }

  // Determine the band size based on underbust measurement
  let bandSize = "";
  if (underbust % 2 === 0) {
    bandSize = underbust.toString();
  } else {
    bandSize = (underbust - 1).toString() + "/" + (underbust + 1).toString();
  }

  // Define recommended locations for bra fitting
  const locations = ["Underbust", "Overbust", "Center Gore"];

  // Combine the underbust measurement and the cup size to get the bra size
  const braSize = {
    cup: cupSize,
    band: bandSize,
    locations: locations
  };

  return braSize;
}



// Calculate the boxer size based on waist and inseam measurements
document.addEventListener("DOMContentLoaded", function() {
  document.getElementById("boxer-size-form").addEventListener("submit", function(event) {
    event.preventDefault();
    const waist = parseFloat(document.getElementById("waist").value);
    const inseam = parseFloat(document.getElementById("inseam").value);
    const boxerSize = calculateBoxerSize(waist, inseam);
    document.getElementById("boxer-size-result").innerText = `Your Boxer Size is: ${boxerSize}`;
  });
});


function calculateBoxerSize(waist, inseam) {
  // Calculate the boxer size based on waist and inseam measurements
  let size = "";
  if (waist >= 28 && waist <= 32 && inseam >= 30 && inseam <= 32) {
    size = "S";
  } else if (waist >= 32 && waist <= 36 && inseam >= 32 && inseam <= 34) {
    size = "M";
  } else if (waist >= 36 && waist <= 40 && inseam >= 34 && inseam <= 36) {
    size = "L";
  } else if (waist >= 40 && waist <= 44 && inseam >= 36 && inseam <= 38) {
    size = "XL";
  } else if (waist >= 44 && inseam >= 38) {
    size = "XXL";
  } else {
    size = "Unknown"; // You can customize this message as needed
  }
  return size;
}
