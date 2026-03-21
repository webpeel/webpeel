import type { DomainExtractResult } from './types.js';
import { fetchJson } from './shared.js';

// ---------------------------------------------------------------------------
// 39. Weather extractor — Open-Meteo free API (no key required)
// ---------------------------------------------------------------------------

// Weather code descriptions (WMO)
const WMO_CODES: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Icy fog',
  51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
  61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
  80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
  85: 'Slight snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Thunderstorm w/ heavy hail',
};

const WEATHER_ICONS: Record<number, string> = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  61: '🌦️', 63: '🌧️', 65: '🌧️',
  71: '🌨️', 73: '❄️', 75: '❄️',
  80: '🌦️', 81: '🌧️', 82: '⛈️',
  85: '🌨️', 86: '❄️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

// Default city coordinates for common weather sites
const DEFAULT_CITY = { name: 'New York City', lat: 40.7128, lon: -74.0060, tz: 'America/New_York' };

export async function weatherExtractor(_html: string, url: string): Promise<DomainExtractResult | null> {
  const urlObj = new URL(url);
  const hostname = urlObj.hostname;

  // Determine lat/lon from URL params (for open-meteo.com direct API links)
  let lat: number | null = null;
  let lon: number | null = null;
  let cityName = DEFAULT_CITY.name;
  let timezone = DEFAULT_CITY.tz;

  if (hostname.includes('open-meteo.com')) {
    const latParam = urlObj.searchParams.get('latitude');
    const lonParam = urlObj.searchParams.get('longitude');
    const tzParam = urlObj.searchParams.get('timezone');
    if (latParam && lonParam) {
      lat = parseFloat(latParam);
      lon = parseFloat(lonParam);
      cityName = `${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E`;
      if (tzParam) timezone = tzParam;
    }
  }

  // For weather.com / accuweather: try to extract city from URL path
  if (hostname.includes('weather.com') || hostname.includes('accuweather.com')) {
    const path = urlObj.pathname;
    // weather.com: /weather/today/l/40.71,-74.01:4:US or similar
    const coordMatch = path.match(/\/l\/(-?\d+\.?\d*),(-?\d+\.?\d*)/);
    if (coordMatch) {
      lat = parseFloat(coordMatch[1]);
      lon = parseFloat(coordMatch[2]);
      cityName = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
    }
  }

  // Default to NYC if no coords found
  if (lat == null || lon == null) {
    lat = DEFAULT_CITY.lat;
    lon = DEFAULT_CITY.lon;
    cityName = DEFAULT_CITY.name;
    timezone = DEFAULT_CITY.tz;
  }

  try {
    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code&timezone=${encodeURIComponent(timezone)}&forecast_days=7`;
    const data = await fetchJson(apiUrl);
    if (!data || data.error) return null;

    const current = data.current || {};
    const daily = data.daily || {};

    const tempC = current.temperature_2m;
    const tempF = tempC != null ? Math.round(tempC * 9 / 5 + 32) : null;
    const humidity = current.relative_humidity_2m;
    const wind = current.wind_speed_10m;
    const wCode = current.weather_code;
    const condition = WMO_CODES[wCode] || 'Unknown';
    const icon = WEATHER_ICONS[wCode] || '🌡️';

    let cleanContent = `# ${icon} Weather Forecast — ${cityName}\n\n`;

    if (tempC != null) {
      cleanContent += `**Current:** ${tempC}°C (${tempF}°F)`;
      if (wind != null) cleanContent += `, Wind: ${wind} km/h`;
      if (humidity != null) cleanContent += `, Humidity: ${humidity}%`;
      cleanContent += `, ${condition}\n\n`;
    }

    if (daily.time?.length) {
      cleanContent += `| Date | Low | High | Precip | Condition |\n`;
      cleanContent += `|------|-----|------|--------|----------|\n`;

      for (let i = 0; i < Math.min(daily.time.length, 7); i++) {
        const date = daily.time[i];
        const low = daily.temperature_2m_min?.[i];
        const high = daily.temperature_2m_max?.[i];
        const precip = daily.precipitation_sum?.[i];
        const dayCode = daily.weather_code?.[i];
        const dayIcon = WEATHER_ICONS[dayCode] || '';
        const dayCondition = WMO_CODES[dayCode] || '';

        const lowStr = low != null ? `${low}°C` : '?';
        const highStr = high != null ? `${high}°C` : '?';
        const precipStr = precip != null ? `${precip}mm` : '0mm';

        cleanContent += `| ${date} | ${lowStr} | ${highStr} | ${precipStr} | ${dayIcon} ${dayCondition} |\n`;
      }
    }

    cleanContent += `\n---\n*Source: Open-Meteo API · Coordinates: ${lat}, ${lon} · Updated: ${data.current?.time || new Date().toISOString()}*`;

    return {
      domain: 'open-meteo.com',
      type: 'forecast',
      structured: {
        city: cityName,
        lat,
        lon,
        timezone,
        current: {
          temperature_c: tempC,
          temperature_f: tempF,
          humidity,
          wind_speed_kmh: wind,
          condition,
          weather_code: wCode,
        },
        daily: daily,
      },
      cleanContent,
    };
  } catch (e) {
    if (process.env.DEBUG) console.debug('[webpeel]', 'Weather API failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

