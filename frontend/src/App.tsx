import "./index.css";

function App() {
  return (
    <>
      <header className="flex flex-row ">
        <h1>dbt Flow Designer</h1>
        <div className="flex flex-row gap-4">
          <button className="border-gray-100 w-30 shadow-md p-3 rounded-full">
            Test
          </button>
          <button className="border-gray-100 w-30 bg-orange-600 text-white shadow-md p-3 rounded-full">
            Save
          </button>
        </div>
      </header>
      <div className="main-content">
        <div className="panel flex-1">
          <h1>Toolbox</h1>
        </div>
        <div className="flex-3">
          <h1></h1>
        </div>
        <div className="panel flex-1">
          <h1>Inspector</h1>
        </div>
      </div>
    </>
  );
}

export default App;
