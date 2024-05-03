import { ethers } from "ethers";
import { request, gql } from "graphql-request";
import axios from "axios";
import {
  poolABI,
  uniswapV3RouterABI,
  uniswapV3FactoryABI,
  erc20ABI,
} from "./abis";
let globalEthPrice = 0;

// Define constants
const WALLET_PRIVATE_KEY =
  "53e4cf35a5daa309df98ffa9b2c627e7a4cb5cd89b5abd35dffddf4477a6b47b";
const PROVIDER_URL =
  "https://mainnet.infura.io/v3/a0c47124ee964d399ee1cedb26eb5c2c";
// "https://rpc.tenderly.co/fork/705ee476-0086-48cd-bc35-e0d48dfda9bd";
const UNISWAPV3_FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const UNISWAPV3_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const USDC_ADDRESS = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const amountToSwap = 40;
const ENABLE_EXECUTION = false;

interface ResponseData {
  pairs: any[];
  pools: any[];
}

// Connect to the network
const provider = new ethers.JsonRpcProvider(PROVIDER_URL);

// Wallet setup
const wallet = new ethers.Wallet(WALLET_PRIVATE_KEY, provider);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getEthUsdcRate() {
  try {
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd"
    );
    const rate = response.data.ethereum.usd;
    return rate;
  } catch (error) {
    console.error("Error getting ETH/USDC rate:", error);
    return null;
  }
}

async function checkProviderStatus(provider) {
  try {
    // Fetch the latest block number
    const latestBlockNumber = await provider.getBlockNumber();
    console.log("Latest block number:", latestBlockNumber);

    // If no errors occurred, the provider is working correctly
    console.log("Provider is working correctly.");
  } catch (error) {
    console.error("Error checking provider status:", error);
    console.log("Provider is not working correctly.");
  }
}

async function getTokenToTokenPrice(
  tokenA,
  tokenB,
  amountA,
  poolAddress,
  provider
) {
  const uniswapContract = new ethers.Contract(poolAddress, poolABI, provider);
  const [slot0, token0] = await Promise.all([
    uniswapContract.slot0(),
    uniswapContract.token0(),
  ]);

  const liquidity = slot0.liquidity;
  const tick = slot0.tick;

  // Determine which token is tokenA and which is tokenB
  let tokenIn, tokenOut;
  if (token0.toLowerCase() === tokenA.toLowerCase()) {
    tokenIn = tokenA;
    tokenOut = tokenB;
  } else {
    tokenIn = tokenB;
    tokenOut = tokenA;
  }

  // Calculate the price using the liquidity and tick data
  const price = Math.exp((Number(tick) * Math.log(1.0001) * Math.log(2)) / 1e6);

  // Calculate the amount of tokenB received for tokenA
  const tokenBAmount = amountA * price;

  return tokenBAmount;
}

const fetchUniswapV2Pairs = async () => {
  const endpoint = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v2";
  const query = gql`
    {
      pairs {
        id
        token0 {
          id
          symbol
        }
        token1 {
          id
          symbol
        }
      }
    }
  `;

  try {
    console.log({ query });
    const data = (await request(endpoint, query)) as ResponseData;
    console.log({ data });
    console.log("check");

    return data.pairs;
  } catch (error) {
    console.error("Error fetching Uniswap pairs:", error);
    return [];
  }
};

// Create an instance of the Uniswap v3 factory contract
const uniswapV3FactoryContract = new ethers.Contract(
  UNISWAPV3_FACTORY_ADDRESS,
  uniswapV3FactoryABI,
  provider
);

// Function to query all Uniswap v3 pool addresses
async function getAllPoolAddresses() {
  const filter = uniswapV3FactoryContract.filters.PoolCreated(
    null,
    null,
    null,
    null,
    null
  );

  const logs = await provider.getLogs({
    ...filter,
    fromBlock: 0,
    toBlock: "latest",
  });

  const poolAddresses = logs.map(
    (log) => uniswapV3FactoryContract.interface.parseLog(log).args.pool
  );
  return poolAddresses;
}

//const pool = getAllPoolAddresses();

const fetchAllUniswapV3Pools = async () => {
  const endpoint = "https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3";

  const pageSize = 1000; // Number of items to fetch per page
  let pools = []; // Array to store all pools
  let skip = 0; // Initial skip value

  while (true) {
    const query = gql`
        {
          pools(where: {liquidity_gt : 0}, first: ${pageSize}, skip: ${skip}) {
            id
            token0 {
              id
              symbol
            }
            token1 {
              id
              symbol
            }
            feeTier
          }
        }
      `;

    try {
      const data = (await request(endpoint, query)) as ResponseData;
      if (data.pools.length === 0) break; // Exit loop if no more pools
      pools = [...pools, ...data.pools]; // Concatenate pools to the result array
      skip += pageSize; // Increment skip value for next page
    } catch (error) {
      console.error("Error fetching Uniswap V3 pools:", error);
      break;
    }
  }

  return pools;
};

const uniswapRouterContract = new ethers.Contract(
  UNISWAPV3_ROUTER_ADDRESS,
  uniswapV3RouterABI,
  provider
);

async function getReserves(uniswapContract) {
  const reserves = await uniswapContract.getReserves();
  return reserves;
}

export function encodePath(path: string[], fees: number[]): string {
  const ADDR_SIZE = 20;
  const FEE_SIZE = 3;
  const OFFSET = ADDR_SIZE + FEE_SIZE;
  const DATA_SIZE = OFFSET + ADDR_SIZE;

  if (path.length != fees.length + 1) {
    throw new Error("path/fee lengths do not match");
  }

  let encoded = "0x";
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2);
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, "0");
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2);

  return encoded.toLowerCase();
}

function prepareSwapDataV2(amountIn, minAmountOut, path) {
  return uniswapRouterContract.interface.encodeFunctionData(
    "swapExactTokensForTokens",
    [
      ethers.parseUnits(amountIn.toString(), "ether"), // 'ether' is used generically for decimal handling
      ethers.parseUnits(minAmountOut.toString(), "ether"),
      path,
      wallet.address,
      Math.floor(Date.now() / 1000) + 1800, // deadline 30 minutes from now
    ]
  );
}

function prepareSwapDataV3(path, recipient, amountIn, minAmountOut, deadline) {
  return uniswapRouterContract.interface.encodeFunctionData("exactInput", [
    {
      path: path,
      recipient: recipient,
      deadline: deadline.toString(),
      amountIn: amountIn.toString(), // Ensuring it's a string
      amountOutMinimum: minAmountOut.toString(),
    },
  ]);
}

async function getCurrentGasPrice(provider) {
  const gasPrice = (await provider.getFeeData()).gasPrice;
  return ethers.formatUnits(gasPrice, "wei");
}

async function estimateGasForSwap(fromAddress, swapData, provider) {
  console.log("Estimating gas for swap");
  const transaction = {
    to: UNISWAPV3_ROUTER_ADDRESS,
    from: fromAddress,
    data: swapData,
    gasLimit: 500000, // Convert number to hexadecimal and add '0x' prefix
  };
  try {
    const gasUsed = await provider.estimateGas(transaction);

    console.log(" Total gas used:", BigInt(gasUsed));
    return BigInt(gasUsed);
  } catch (error) {
    console.error(" Failed to estimate gas");
    if (error.reason == "STF") {
      console.error("   The swap amount is too big");
      console.log(error);
    } else {
      console.error(error);
    }

    return BigInt(0);
  }
}

async function calculateTotalTransactionCost(combinedSwapData, provider) {
  const gasPrice = ethers.parseUnits(await getCurrentGasPrice(provider), "wei");

  const gasLimit = await estimateGasForSwap(
    wallet.address,
    combinedSwapData,
    provider
  );

  const totalCostEth = gasPrice * BigInt(gasLimit);
  const ethUsdcRate = globalEthPrice;
  const totalGasCostUsdc = (Number(totalCostEth) * ethUsdcRate) / 1e18;
  return totalGasCostUsdc.toString();
}

async function monitorArbitrageAcrossVersions(provider) {
  try {
    const ethprice = await getEthUsdcRate(); // Implement this function
    globalEthPrice = ethprice;
    console.log("Starting to monitor arbitrage opportunities...");

    console.log("checking v2 pools");
    //const v2Pools = await fetchUniswapV2Pairs();
    console.log("checking v3 pools");
    const v3Pools = await fetchAllUniswapV3Pools();
    const allPools = v3Pools;

    console.log(
      `Monitoring ${allPools.length} pools across Uniswap V2 and V3.`
    );

    // Maps token IDs to pools where the token is present for quick access
    const tokenToPools = {};

    // Aggregate pools data from V2 and V3 into a single map
    allPools.forEach(async (pool) => {
      [pool.token0.id, pool.token1.id].forEach(async (tokenId) => {
        if (!tokenToPools[tokenId]) {
          tokenToPools[tokenId] = [];
        }

        tokenToPools[tokenId].push(pool);
      });
    });

    const usdcPools = tokenToPools[USDC_ADDRESS] || [];

    let cntAll = 0;

    for (const poolAB of usdcPools) {
      const tokenB =
        poolAB.token0.id === USDC_ADDRESS ? poolAB.token1.id : poolAB.token0.id;
      const poolsWithB = tokenToPools[tokenB] || [];

      for (const tokenC in tokenToPools) {
        if (tokenC === USDC_ADDRESS || tokenC === tokenB) continue; // Skip if it's USDC or tokenB

        const poolsWithC = tokenToPools[tokenC] || [];

        for (const poolCA of poolsWithC) {
          if (
            (poolCA.token0.id === tokenC &&
              poolCA.token1.id === USDC_ADDRESS) ||
            (poolCA.token1.id === tokenC && poolCA.token0.id === USDC_ADDRESS)
          ) {
            // We have a complete triangle: USDC -> tokenB -> tokenC -> USDC
            for (const poolBC of poolsWithB) {
              if (
                (poolBC.token0.id === tokenB && poolBC.token1.id === tokenC) ||
                (poolBC.token1.id === tokenB && poolBC.token0.id === tokenC)
              ) {
                console.log("===============================", cntAll);
                console.log(
                  "checking arbitrage between pool A: " +
                    poolAB.id +
                    " pool B: " +
                    poolBC.id +
                    " pool C: " +
                    poolCA.id
                );

                await checkArbitrageOpportunity(
                  amountToSwap, // Example starting amount, adjust as necessary
                  USDC_ADDRESS,
                  tokenB,
                  tokenC,
                  poolAB.id,
                  poolBC.id,
                  poolCA.id,
                  poolAB.feeTier, // Pass the actual fee values
                  poolBC.feeTier,
                  poolCA.feeTier,
                  provider
                );

                cntAll++;
              }
            }
          }
        }
      }
    }
    setTimeout(() => monitorArbitrageAcrossVersions(provider), 5000); // Check every 5 seconds (for testing purposes
  } catch (error) {
    console.error(error);
  }
}

async function checkArbitrageOpportunity(
  amount,
  tokenA,
  tokenB,
  tokenC,
  poolAB,
  poolBC,
  poolCA,
  feeAB, // Add fee parameters
  feeBC,
  feeCA,
  provider
) {
  // console.log("checkArbitrageOpportunity - Get Swap token amount");
  const amountB = await getTokenToTokenPrice(
    tokenA,
    tokenB,
    amount,
    poolAB,
    provider
  );

  const amountC = await getTokenToTokenPrice(
    tokenB,
    tokenC,
    amountB,
    poolBC,
    provider
  );

  const finalAmountA = await getTokenToTokenPrice(
    tokenC,
    tokenA,
    amountC,
    poolCA,
    provider
  );

  // console.log("checkArbitrageOpportunity - Check pool liquidity");
  const tokenAContract = new ethers.Contract(tokenA, erc20ABI, provider);
  const tokenBContract = new ethers.Contract(tokenB, erc20ABI, provider);
  const tokenCContract = new ethers.Contract(tokenC, erc20ABI, provider);
  if ((await tokenBContract.balanceOf(poolAB)) <= amountB) {
    console.log(
      `No profitable arbitrage opportunity. Not enough liquidity in Pool: ${poolAB} for ${tokenB}`
    );
    return;
  }
  if ((await tokenCContract.balanceOf(poolBC)) <= amountC) {
    console.log(
      `No profitable arbitrage opportunity. Not enough liquidity in Pool: ${poolBC} for ${tokenC}`
    );
    return;
  }
  if ((await tokenAContract.balanceOf(poolCA)) <= amountB) {
    console.log(
      `No profitable arbitrage opportunity. Not enough liquidity in Pool: ${poolCA} for ${tokenA}`
    );
    return;
  }

  // Prepare swap data for all three swaps
  const feeNumberAB = parseFloat(feeAB);
  const feeNumberBC = parseFloat(feeBC);
  const feeNumberCA = parseFloat(feeCA);
  const path = encodePath(
    [tokenA, tokenB, tokenC, tokenA],
    [feeNumberAB, feeNumberBC, feeNumberCA]
  );

  const amountInWei = BigInt(Math.floor(parseFloat(amount) * 1e6));
  const zeroInWei = BigInt(0); // Zero value for transactions
  const deadline = Math.floor(Date.now() / 1000) + 1800; // 30 minutes from now

  console.log("Tokens : ", tokenA, tokenB, tokenC);
  console.log("Fee for pools : ", feeAB, feeBC, feeCA);

  const swapData = prepareSwapDataV3(
    path,
    wallet.address,
    amountInWei,
    zeroInWei,
    deadline
  );

  // Combine swap data into one transaction
  const profit = finalAmountA - amount;

  // Calculate total transaction cost in USD
  const TRANSACTION_COST_USD = parseFloat(
    await calculateTotalTransactionCost(swapData, provider)
  );

  if (TRANSACTION_COST_USD != 0)
    if (profit > TRANSACTION_COST_USD) {
      const PROFITLOSS = profit - TRANSACTION_COST_USD;
      console.log(
        `Arbitrage opportunity found! Profit: ${PROFITLOSS} ${tokenA}`
      );

      // Execute combined transaction
      if (ENABLE_EXECUTION) {
        const tx = await wallet.sendTransaction({
          to: UNISWAPV3_ROUTER_ADDRESS,
          data: swapData, // Add '0x' prefix
          gasPrice: ethers.parseUnits(
            await getCurrentGasPrice(provider),
            "gwei"
          ),
          gasLimit: await estimateGasForSwap(
            wallet.address,
            swapData,
            provider
          ),
        });

        const receipt = await tx.wait();
        console.log("Transaction mined:", receipt);
      }
    } else if (profit < 0) {
      console.log(
        `No profitable arbitrage opportunity. Profit: ${profit} ${tokenA} Transaction cost: ${TRANSACTION_COST_USD} USD`
      );
    } else {
      const targetAmountSwap = (amountToSwap * TRANSACTION_COST_USD) / profit;
      console.log(
        `Arbitrage opportunity found! min SwapAmount : ${targetAmountSwap} Profit: ${TRANSACTION_COST_USD} ${tokenA} Transaction cost: ${TRANSACTION_COST_USD} USD`
      );
    }
}

// Call the function to check the provider status
checkProviderStatus(provider);

// Initial call to start the monitoring loop
monitorArbitrageAcrossVersions(provider);
