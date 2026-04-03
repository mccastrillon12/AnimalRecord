
const primitiveData = {
    id: "uuid-123",
    name: "Test Name",
    department: undefined,
    address: undefined,
    city: "City",
    roles: ["USER"]
};

const setQuery = {};
const unsetQuery = {};

for (const [key, value] of Object.entries(primitiveData)) {
    if (value === undefined) {
        unsetQuery[key] = 1;
    } else {
        setQuery[key] = value;
    }
}

const updateDoc_ = {};
if (Object.keys(setQuery).length > 0) updateDoc_.$set = setQuery;
if (Object.keys(unsetQuery).length > 0) updateDoc_.$unset = unsetQuery;

console.dir(updateDoc_, { depth: null });
