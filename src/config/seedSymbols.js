const CORE_INDICES = [
    {
        "symbol":  "NSE:NIFTY 50-INDEX",
        "name":  "Nifty 50",
        "segment":  "INDICES",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  true,
        "sourceSymbol":  "NSE:NIFTY 50"
    },
    {
        "symbol":  "NSE:NIFTY BANK-INDEX",
        "name":  "Nifty Bank",
        "segment":  "INDICES",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  true,
        "sourceSymbol":  "NSE:NIFTY BANK"
    },
    {
        "symbol":  "NSE:NIFTY FIN SERVICE-INDEX",
        "name":  "Nifty Financial Services",
        "segment":  "INDICES",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:NIFTY FIN SERVICE"
    },
    {
        "symbol":  "NSE:INDIA VIX",
        "name":  "India VIX",
        "segment":  "INDICES",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:INDIA VIX"
    }
];

const NIFTY50_EQUITIES = [
    {
        "symbol":  "NSE:ADANIENT",
        "name":  "Adani Enterprises Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:ADANIENT"
    },
    {
        "symbol":  "NSE:ADANIPORTS",
        "name":  "Adani Ports and Special Economic Zone Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:ADANIPORTS"
    },
    {
        "symbol":  "NSE:APOLLOHOSP",
        "name":  "Apollo Hospitals Enterprise Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:APOLLOHOSP"
    },
    {
        "symbol":  "NSE:ASIANPAINT",
        "name":  "Asian Paints Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:ASIANPAINT"
    },
    {
        "symbol":  "NSE:AXISBANK",
        "name":  "Axis Bank Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:AXISBANK"
    },
    {
        "symbol":  "NSE:BAJAJ-AUTO",
        "name":  "Bajaj Auto Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:BAJAJ-AUTO"
    },
    {
        "symbol":  "NSE:BAJFINANCE",
        "name":  "Bajaj Finance Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:BAJFINANCE"
    },
    {
        "symbol":  "NSE:BAJAJFINSV",
        "name":  "Bajaj Finserv Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:BAJAJFINSV"
    },
    {
        "symbol":  "NSE:BEL",
        "name":  "Bharat Electronics Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:BEL"
    },
    {
        "symbol":  "NSE:BHARTIARTL",
        "name":  "Bharti Airtel Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:BHARTIARTL"
    },
    {
        "symbol":  "NSE:CIPLA",
        "name":  "Cipla Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:CIPLA"
    },
    {
        "symbol":  "NSE:COALINDIA",
        "name":  "Coal India Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:COALINDIA"
    },
    {
        "symbol":  "NSE:DRREDDY",
        "name":  "Dr. Reddy\u0027s Laboratories Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:DRREDDY"
    },
    {
        "symbol":  "NSE:EICHERMOT",
        "name":  "Eicher Motors Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:EICHERMOT"
    },
    {
        "symbol":  "NSE:ETERNAL",
        "name":  "Eternal Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:ETERNAL"
    },
    {
        "symbol":  "NSE:GRASIM",
        "name":  "Grasim Industries Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:GRASIM"
    },
    {
        "symbol":  "NSE:HCLTECH",
        "name":  "HCL Technologies Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:HCLTECH"
    },
    {
        "symbol":  "NSE:HDFCBANK",
        "name":  "HDFC Bank Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:HDFCBANK"
    },
    {
        "symbol":  "NSE:HDFCLIFE",
        "name":  "HDFC Life Insurance Company Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:HDFCLIFE"
    },
    {
        "symbol":  "NSE:HINDALCO",
        "name":  "Hindalco Industries Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:HINDALCO"
    },
    {
        "symbol":  "NSE:HINDUNILVR",
        "name":  "Hindustan Unilever Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:HINDUNILVR"
    },
    {
        "symbol":  "NSE:ICICIBANK",
        "name":  "ICICI Bank Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:ICICIBANK"
    },
    {
        "symbol":  "NSE:ITC",
        "name":  "ITC Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:ITC"
    },
    {
        "symbol":  "NSE:INFY",
        "name":  "Infosys Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:INFY"
    },
    {
        "symbol":  "NSE:INDIGO",
        "name":  "InterGlobe Aviation Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:INDIGO"
    },
    {
        "symbol":  "NSE:JSWSTEEL",
        "name":  "JSW Steel Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:JSWSTEEL"
    },
    {
        "symbol":  "NSE:JIOFIN",
        "name":  "Jio Financial Services Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:JIOFIN"
    },
    {
        "symbol":  "NSE:KOTAKBANK",
        "name":  "Kotak Mahindra Bank Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:KOTAKBANK"
    },
    {
        "symbol":  "NSE:LT",
        "name":  "Larsen \u0026 Toubro Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:LT"
    },
    {
        "symbol":  "NSE:M\u0026M",
        "name":  "Mahindra \u0026 Mahindra Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:M\u0026M"
    },
    {
        "symbol":  "NSE:MARUTI",
        "name":  "Maruti Suzuki India Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:MARUTI"
    },
    {
        "symbol":  "NSE:MAXHEALTH",
        "name":  "Max Healthcare Institute Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:MAXHEALTH"
    },
    {
        "symbol":  "NSE:NTPC",
        "name":  "NTPC Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:NTPC"
    },
    {
        "symbol":  "NSE:NESTLEIND",
        "name":  "Nestle India Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:NESTLEIND"
    },
    {
        "symbol":  "NSE:ONGC",
        "name":  "Oil \u0026 Natural Gas Corporation Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:ONGC"
    },
    {
        "symbol":  "NSE:POWERGRID",
        "name":  "Power Grid Corporation of India Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:POWERGRID"
    },
    {
        "symbol":  "NSE:RELIANCE",
        "name":  "Reliance Industries Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:RELIANCE"
    },
    {
        "symbol":  "NSE:SBILIFE",
        "name":  "SBI Life Insurance Company Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:SBILIFE"
    },
    {
        "symbol":  "NSE:SHRIRAMFIN",
        "name":  "Shriram Finance Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:SHRIRAMFIN"
    },
    {
        "symbol":  "NSE:SBIN",
        "name":  "State Bank of India",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:SBIN"
    },
    {
        "symbol":  "NSE:SUNPHARMA",
        "name":  "Sun Pharmaceutical Industries Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:SUNPHARMA"
    },
    {
        "symbol":  "NSE:TCS",
        "name":  "Tata Consultancy Services Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:TCS"
    },
    {
        "symbol":  "NSE:TATACONSUM",
        "name":  "Tata Consumer Products Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:TATACONSUM"
    },
    {
        "symbol":  "NSE:TMPV",
        "name":  "Tata Motors Passenger Vehicles Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:TMPV"
    },
    {
        "symbol":  "NSE:TATASTEEL",
        "name":  "Tata Steel Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:TATASTEEL"
    },
    {
        "symbol":  "NSE:TECHM",
        "name":  "Tech Mahindra Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:TECHM"
    },
    {
        "symbol":  "NSE:TITAN",
        "name":  "Titan Company Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:TITAN"
    },
    {
        "symbol":  "NSE:TRENT",
        "name":  "Trent Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:TRENT"
    },
    {
        "symbol":  "NSE:ULTRACEMCO",
        "name":  "UltraTech Cement Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:ULTRACEMCO"
    },
    {
        "symbol":  "NSE:WIPRO",
        "name":  "Wipro Ltd.",
        "segment":  "EQUITY",
        "exchange":  "NSE",
        "provider":  "kite",
        "isWatchlist":  false,
        "sourceSymbol":  "NSE:WIPRO"
    }
];

const SEED_SYMBOLS = [...CORE_INDICES, ...NIFTY50_EQUITIES];

const KITE_SYNC_SYMBOLS = SEED_SYMBOLS.filter((item) => String(item.provider || '').toLowerCase() === 'kite');

export { CORE_INDICES, NIFTY50_EQUITIES, SEED_SYMBOLS, KITE_SYNC_SYMBOLS };
